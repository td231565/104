(() => {
  const MISSING = "未提供";

  function cleanMultiline(value) {
    if (!value) {
      return "";
    }

    return String(value)
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  function markdownText(value) {
    return String(value ?? "")
      .replaceAll("\\", "\\\\")
      .replaceAll("`", "\\`")
      .replaceAll("|", "\\|");
  }

  function contentLines(value) {
    value = cleanMultiline(value);
    if (!value) {
      return [MISSING];
    }

    value = value
      .replace(/\s*▮\s*/g, "\n")
      .replace(/\s*〓([^〓]+)〓/g, "\n$1\n")
      .replace(/\s*[-─－]{5,}\s*/g, "\n");

    return value
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => markdownText(line.replace(/^[\-• ]+/, "")));
  }

  function addField(lines, key, value, indent = 0) {
    const prefix = "  ".repeat(indent);
    if (Array.isArray(value)) {
      lines.push(`${prefix}- ${key}:`);
      for (const item of value.length ? value : [MISSING]) {
        lines.push(`${prefix}  - ${markdownText(item)}`);
      }
      return;
    }

    if (value && typeof value === "object") {
      lines.push(`${prefix}- ${key}:`);
      for (const [childKey, childValue] of Object.entries(value)) {
        addField(lines, childKey, childValue, indent + 1);
      }
      return;
    }

    value = value === undefined || value === null ? "" : cleanMultiline(value);
    if (!value) {
      value = MISSING;
    }
    if (value.includes("\n")) {
      lines.push(`${prefix}- ${key}:`);
      for (const item of contentLines(value)) {
        lines.push(`${prefix}  - ${item}`);
      }
    } else {
      lines.push(`${prefix}- ${key}: ${markdownText(value)}`);
    }
  }

  function addContentSection(lines, title, content) {
    lines.push(`## ${title}`, "");
    for (const item of contentLines(content)) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  function renderMarkdown(record) {
    const header = record.header || {};
    const benefits = record.benefits || {};
    const lines = [
      `# ${markdownText(record.title || MISSING)}`,
      "",
      "## 基本資料",
      "",
    ];

    for (const [key, value] of [
      ["職缺編號", record.job_id],
      ["公司名稱", record.company],
      ["公司網址", record.company_url],
      ["產業類別", record.industry],
      ["薪資", record.salary],
      ["工作性質", record.employment_type],
      ["工作地點", record.location],
      ["遠端工作", record.remote_work],
      ["上班時段", record.work_hours],
      ["管理責任", record.management],
      ["出差外派", record.business_trip],
      ["休假制度", record.vacation_policy],
      ["可上班日", record.start_working_day],
      ["需求人數", record.headcount],
      ["應徵人數", header.應徵人數],
      ["履歷處理速度", header.履歷處理速度],
      ["公司評價", record.company_rating],
      ["公司環境照片數", record.environment_photos],
    ]) {
      addField(lines, key, value);
    }
    lines.push("");

    addContentSection(lines, "工作內容", record.description);

    lines.push("## 條件要求", "");
    for (const [key, value] of [
      ["工作經歷", record.experience],
      ["學歷要求", record.education],
      ["科系要求", record.department],
      ["語文條件", record.language],
      ["擅長工具", record.tools],
      ["工作技能", record.skills],
      ["其他條件", record.other_conditions],
    ]) {
      addField(lines, key, value);
    }
    lines.push("");

    lines.push("## 福利制度", "");
    addField(lines, "法定項目", benefits.法定項目 || []);
    addField(lines, "其他福利", benefits.其他福利 || []);
    addField(lines, "福利說明", benefits.福利說明 || "");
    lines.push("");

    lines.push("## 聯絡與應徵", "");
    addField(lines, "聯絡人", record.contact);
    addField(lines, "應徵網址", benefits.應徵網址 || "");
    lines.push("");

    lines.push("## 來源資訊", "");
    for (const [key, value] of [
      ["來源網址", record.source_url],
      ["發布日期", record.date_posted],
      ["有效期限", record.valid_through],
      ["頁面更新日期", header.更新日期],
    ]) {
      addField(lines, key, value);
    }

    return `${lines.join("\n").trimEnd()}\n`;
  }

  function safeFilenameSegment(value, fallback) {
    const safe = String(value ?? "")
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^\.+|\.+$/g, "")
      .trim();
    return safe || fallback;
  }

  function getDownloadFilename(record) {
    const jobId = safeFilenameSegment(record.job_id, "job");
    const company = safeFilenameSegment(record.company, "公司");
    const title = safeFilenameSegment(record.title, "職缺");
    return `104/${jobId}-${company}-${title}.md`;
  }

  function renderListMarkdown(record) {
    const keyword = record.keyword || "全部工作";
    const page = record.page || "1";
    const jobs = Array.isArray(record.jobs) ? record.jobs : [];

    const lines = [
      `# 104 職缺搜尋結果 - ${markdownText(keyword)} (第 ${markdownText(page)} 頁)`,
      "",
      "## 檢索資訊",
      "",
    ];

    for (const [key, value] of [
      ["搜尋關鍵字", keyword],
      ["頁碼", `第 ${page} 頁`],
      ["本頁職缺數", `${jobs.length} 筆`],
      ["搜尋結果總筆數", record.total_count],
      ["搜尋來源網址", record.source_url],
    ]) {
      addField(lines, key, value);
    }
    lines.push("");

    lines.push("## 職缺清單", "");
    if (!jobs.length) {
      lines.push("- 未找到任何職缺", "");
    } else {
      jobs.forEach((job, index) => {
        lines.push(`### ${index + 1}. ${markdownText(job.title || MISSING)}`, "");
        for (const [key, value] of [
          ["職缺編號", job.job_id],
          ["公司名稱", job.company],
          ["公司網址", job.company_url],
          ["產業類別", job.industry],
          ["薪資待遇", job.salary],
          ["工作地點", job.location],
          ["工作經歷", job.experience],
          ["學歷要求", job.education],
          ["應徵人數", job.applicants],
          ["更新日期", job.date],
          ["標籤", job.other_tags],
          ["職缺網址", job.source_url],
          ["工作內容摘要", job.description],
        ]) {
          addField(lines, key, value);
        }
        lines.push("");
      });
    }

    return `${lines.join("\n").trimEnd()}\n`;
  }

  function getListDownloadFilename(record) {
    const keyword = safeFilenameSegment(record.keyword, "全部工作");
    const page = safeFilenameSegment(record.page, "1");
    return `104/search-${keyword}-p${page}.md`;
  }

  globalThis.render104Markdown = renderMarkdown;
  globalThis.get104DownloadFilename = getDownloadFilename;
  globalThis.render104ListMarkdown = renderListMarkdown;
  globalThis.get104ListDownloadFilename = getListDownloadFilename;
})();

