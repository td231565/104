#!/usr/bin/env python3
"""Extract the useful fields from a 104 job HTML page into Markdown."""

from __future__ import annotations

import argparse
import json
import re
import sys
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from lxml import html
except ImportError as exc:  # pragma: no cover - depends on the local runtime
    raise SystemExit("需要安裝 lxml：python3 -m pip install lxml") from exc


MISSING = "未提供"


def class_xpath(class_name: str) -> str:
    return (
        '//*[contains(concat(" ", normalize-space(@class), " "), '
        f'" {class_name} ")]'
    )


def clean_inline(value: str | None) -> str:
    if not value:
        return ""
    value = unescape(value).replace("\xa0", " ")
    return re.sub(r"[ \t\f\v]+", " ", value).strip()


def clean_multiline(value: str | None) -> str:
    if not value:
        return ""
    lines = []
    for line in unescape(value).replace("\xa0", " ").replace("\r\n", "\n").splitlines():
        line = re.sub(r"[ \t\f\v]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def node_text(node: Any) -> str:
    """Read visible text while turning <br> into real line breaks."""

    parts: list[str] = []

    def visit(element: Any) -> None:
        if element.text:
            parts.append(element.text)
        for child in element:
            if isinstance(child.tag, str):
                if child.tag.lower() == "br":
                    parts.append("\n")
                else:
                    visit(child)
            if child.tail:
                parts.append(child.tail)

    visit(node)
    return clean_multiline("".join(parts))


def first_text(nodes: list[Any]) -> str:
    return node_text(nodes[0]) if nodes else ""


def first_attr(root: Any, xpath: str) -> str:
    values = root.xpath(xpath)
    return clean_inline(values[0]) if values else ""


def parse_json_ld(root: Any) -> dict[str, Any]:
    for script in root.xpath('//script[@type="application/ld+json"]'):
        raw = script.text or ""
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue

        items = value if isinstance(value, list) else [value]
        for item in items:
            if not isinstance(item, dict):
                continue
            types = item.get("@type", [])
            types = types if isinstance(types, list) else [types]
            if "JobPosting" in types:
                return item
    return {}


def extract_rows(root: Any, section_class: str) -> dict[str, str]:
    """Extract label/value rows from one or more duplicated responsive sections."""

    rows: dict[str, str] = {}
    for section in root.xpath(class_xpath(section_class)):
        for row in section.xpath("." + class_xpath("list-row")):
            heads = row.xpath("." + class_xpath("list-row__head"))
            data = row.xpath("." + class_xpath("list-row__data"))
            if not heads or not data:
                continue

            label = clean_inline(node_text(heads[0]))
            value_node = data[0]
            if label == "職務類別":
                category = value_node.xpath("." + class_xpath("category-item"))
                value = first_text(category) if category else node_text(value_node)
            else:
                value = node_text(value_node)

            if label and value and label not in rows:
                rows[label] = value
    return rows


def longest_text(root: Any, class_name: str) -> str:
    values = [node_text(node) for node in root.xpath(class_xpath(class_name))]
    values = [value for value in values if value]
    return max(values, key=len, default="")


def json_value(value: Any) -> str:
    if isinstance(value, list):
        values = [json_value(item) for item in value]
        return ", ".join(item for item in values if item)
    if isinstance(value, dict):
        if value.get("value") is not None:
            return json_value(value["value"])
        for key in ("name", "credentialCategory", "unitText", "monthsOfExperience"):
            if value.get(key) is not None:
                return json_value(value[key])
        return ""
    return clean_inline(str(value)) if value is not None else ""


def get_address(job: dict[str, Any]) -> str:
    location = job.get("jobLocation", {})
    address = location.get("address", {}) if isinstance(location, dict) else {}
    if not isinstance(address, dict):
        return ""
    return clean_inline(
        " ".join(
            part
            for part in (
                address.get("addressRegion"),
                address.get("addressLocality"),
                address.get("streetAddress"),
            )
            if part
        )
    )


def get_identifier(job: dict[str, Any], source_url: str) -> str:
    identifier = job.get("identifier", {})
    if isinstance(identifier, dict) and identifier.get("value"):
        return clean_inline(str(identifier["value"]))
    return urlparse(source_url).path.rstrip("/").rsplit("/", 1)[-1]


def extract_header(root: Any) -> dict[str, str]:
    header = longest_text(root, "job-header")
    result: dict[str, str] = {}
    update = re.search(r"\b\d{1,2}/\d{1,2}更新\b", header)
    applicants = re.search(r"應徵人數\s*([0-9]+\s*[~～-]\s*[0-9]+\s*人?)", header)
    handling = re.search(r"\d+\s*天內處理過履歷", header)
    if update:
        result["更新日期"] = update.group(0).removesuffix("更新")
    if applicants:
        result["應徵人數"] = clean_inline(applicants.group(1))
    if handling:
        result["履歷處理速度"] = clean_inline(handling.group(0))
    return result


def extract_contact(root: Any) -> str:
    for row in root.xpath(class_xpath("job-contact-table")):
        head = first_text(row.xpath("." + class_xpath("job-contact-table__head")))
        if head != "聯絡人":
            continue
        value = first_text(row.xpath("." + class_xpath("job-contact-table__data")))
        return clean_inline(value.split("104人力銀行提醒", 1)[0])
    return ""


def extract_benefits(root: Any) -> dict[str, Any]:
    sections = root.xpath(class_xpath("benefits"))
    if not sections:
        return {"法定項目": [], "其他福利": [], "福利說明": "", "應徵網址": ""}

    section = sections[0]
    result: dict[str, Any] = {"法定項目": [], "其他福利": [], "福利說明": "", "應徵網址": ""}
    for row in section.xpath(class_xpath("benefits-labels")):
        heading = row.xpath('./preceding-sibling::div[1]//h3')
        label = first_text(heading)
        tags = [clean_inline(node_text(tag)) for tag in row.xpath(".//span[contains(@class, 'tag')]")]
        tags = [tag for tag in tags if tag]
        if label in result:
            result[label] = tags

    result["福利說明"] = longest_text(section, "benefits-description")
    urls = section.xpath('.//a[contains(@href, "recruit.asus.com")]/@href')
    if urls:
        result["應徵網址"] = clean_inline(urls[0])
    else:
        text_urls = re.findall(r"https?://[^\s<]+", result["福利說明"])
        if text_urls:
            result["應徵網址"] = text_urls[0].rstrip(".,)")
    return result


def extract_company_rating(root: Any) -> str:
    for node in root.xpath(class_xpath("comment")):
        match = re.search(r"公司評價\s*([0-5](?:\.\d)?)", node_text(node))
        if match:
            return match.group(1)
    return ""


def extract_environment_photo_count(root: Any) -> str:
    for node in root.xpath(class_xpath("environment")):
        match = re.search(r"公司環境照片\s*\((\d+)張\)", node_text(node))
        if match:
            return match.group(1)
    return ""


def extract_job(path: Path) -> dict[str, Any]:
    source = path.read_text(encoding="utf-8-sig")
    root = html.document_fromstring(source)
    job = parse_json_ld(root)
    rows = extract_rows(root, "job-description")
    rows.update({key: value for key, value in extract_rows(root, "job-requirement").items() if key not in rows})

    source_url = first_attr(root, '//meta[@property="og:url"]/@content')
    source_url = source_url or clean_inline(str(job.get("url", "")).split("?", 1)[0])
    organization = job.get("hiringOrganization", {})
    organization = organization if isinstance(organization, dict) else {}
    company_url = clean_inline(str(organization.get("sameAs", "")))

    title = clean_inline(str(job.get("title", "")))
    if not title:
        title = first_text(root.xpath("//h1"))
    if not title:
        raise ValueError("找不到職缺標題")

    benefits = extract_benefits(root)
    header = extract_header(root)
    salary = rows.get("工作待遇", "")
    location = rows.get("上班地點", "") or get_address(job)
    employment_type = rows.get("工作性質", "")
    if not employment_type:
        employment_type = "全職" if "FULL_TIME" in json_value(job.get("employmentType")) else ""

    experience = rows.get("工作經歷", "")
    if not experience:
        months = job.get("experienceRequirements", {}).get("monthsOfExperience")
        if months:
            experience = f"{int(months) // 12}年以上"

    education = rows.get("學歷要求", "")
    if not education:
        education = json_value(job.get("educationRequirements"))

    work_hours = rows.get("上班時段", "") or json_value(job.get("workHours"))
    company = clean_inline(str(organization.get("name", "")))
    if not company:
        company_links = root.xpath('//a[contains(@href, "/company/")]/text()')
        company = clean_inline(company_links[0]) if company_links else ""

    return {
        "title": title,
        "job_id": get_identifier(job, source_url),
        "company": company,
        "company_url": company_url,
        "industry": clean_inline(str(job.get("industry", ""))),
        "salary": salary or json_value(job.get("baseSalary")),
        "employment_type": employment_type,
        "location": location,
        "remote_work": rows.get("遠端工作", "") or "未標示",
        "work_hours": work_hours,
        "management": rows.get("管理責任", ""),
        "business_trip": rows.get("出差外派", ""),
        "vacation_policy": rows.get("休假制度", ""),
        "start_working_day": rows.get("可上班日", ""),
        "headcount": rows.get("需求人數", ""),
        "experience": experience,
        "education": education,
        "department": rows.get("科系要求", ""),
        "language": rows.get("語文條件", ""),
        "tools": rows.get("擅長工具", ""),
        "skills": rows.get("工作技能", ""),
        "other_conditions": rows.get("其他條件", ""),
        "description": longest_text(root, "job-description__content"),
        "contact": extract_contact(root),
        "benefits": benefits,
        "date_posted": clean_inline(str(job.get("datePosted", ""))),
        "valid_through": clean_inline(str(job.get("validThrough", ""))),
        "header": header,
        "company_rating": extract_company_rating(root),
        "environment_photos": extract_environment_photo_count(root),
        "source_file": str(path),
        "source_url": source_url,
    }


def markdown_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("`", "\\`").replace("|", "\\|")


def content_lines(value: str) -> list[str]:
    value = clean_multiline(value)
    if not value:
        return [MISSING]
    value = re.sub(r"\s*▮\s*", "\n", value)
    value = re.sub(r"\s*〓([^〓]+)〓", r"\n\1\n", value)
    value = re.sub(r"\s*[-─－]{5,}\s*", "\n", value)
    return [markdown_text(line.lstrip("-• ")) for line in value.splitlines() if line.strip()]


def add_field(lines: list[str], key: str, value: Any, indent: int = 0) -> None:
    prefix = "  " * indent
    if isinstance(value, dict):
        lines.append(f"{prefix}- {key}:")
        for child_key, child_value in value.items():
            add_field(lines, child_key, child_value, indent + 1)
        return
    if isinstance(value, list):
        lines.append(f"{prefix}- {key}:")
        for item in value or [MISSING]:
            lines.append(f"{prefix}  - {markdown_text(str(item))}")
        return
    value = clean_multiline(str(value)) if value is not None else ""
    if not value:
        value = MISSING
    if "\n" in value:
        lines.append(f"{prefix}- {key}:")
        for item in content_lines(value):
            lines.append(f"{prefix}  - {item}")
    else:
        lines.append(f"{prefix}- {key}: {markdown_text(value)}")


def add_content_section(lines: list[str], title: str, content: str) -> None:
    lines.extend([f"## {title}", ""])
    for item in content_lines(content):
        lines.append(f"- {item}")
    lines.append("")


def render_markdown(record: dict[str, Any]) -> str:
    lines = [f"# {markdown_text(record['title'])}", "", "## 基本資料", ""]
    basic_fields = (
        ("職缺編號", record["job_id"]),
        ("公司名稱", record["company"]),
        ("公司網址", record["company_url"]),
        ("產業類別", record["industry"]),
        ("薪資", record["salary"]),
        ("工作性質", record["employment_type"]),
        ("工作地點", record["location"]),
        ("遠端工作", record["remote_work"]),
        ("上班時段", record["work_hours"]),
        ("管理責任", record["management"]),
        ("出差外派", record["business_trip"]),
        ("休假制度", record["vacation_policy"]),
        ("可上班日", record["start_working_day"]),
        ("需求人數", record["headcount"]),
        ("應徵人數", record["header"].get("應徵人數", "")),
        ("履歷處理速度", record["header"].get("履歷處理速度", "")),
        ("公司評價", record["company_rating"]),
        ("公司環境照片數", record["environment_photos"]),
    )
    for key, value in basic_fields:
        add_field(lines, key, value)
    lines.append("")

    add_content_section(lines, "工作內容", record["description"])

    lines.extend(["## 條件要求", ""])
    for key, value in (
        ("工作經歷", record["experience"]),
        ("學歷要求", record["education"]),
        ("科系要求", record["department"]),
        ("語文條件", record["language"]),
        ("擅長工具", record["tools"]),
        ("工作技能", record["skills"]),
        ("其他條件", record["other_conditions"]),
    ):
        add_field(lines, key, value)
    lines.append("")

    lines.extend(["## 福利制度", ""])
    benefits = record["benefits"]
    add_field(lines, "法定項目", benefits.get("法定項目", []))
    add_field(lines, "其他福利", benefits.get("其他福利", []))
    add_field(lines, "福利說明", benefits.get("福利說明", ""))
    lines.append("")

    lines.extend(["## 聯絡與應徵", ""])
    add_field(lines, "聯絡人", record["contact"])
    add_field(lines, "應徵網址", benefits.get("應徵網址", ""))
    lines.append("")

    lines.extend(["## 來源資訊", ""])
    for key, value in (
        ("原始檔案", record["source_file"]),
        ("來源網址", record["source_url"]),
        ("發布日期", record["date_posted"]),
        ("有效期限", record["valid_through"]),
        ("頁面更新日期", record["header"].get("更新日期", "")),
    ):
        add_field(lines, key, value)

    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="將 104 職缺 HTML 解析成 Markdown")
    parser.add_argument("input", type=Path, help="輸入 HTML 檔案")
    parser.add_argument("-o", "--output", type=Path, help="輸出 Markdown 檔案；預設與輸入檔同名")
    args = parser.parse_args(argv)

    try:
        record = extract_job(args.input)
        output = args.output or args.input.with_suffix(".md")
        output.write_text(render_markdown(record), encoding="utf-8")
    except (OSError, ValueError) as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return 1

    print(f"已輸出：{output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
