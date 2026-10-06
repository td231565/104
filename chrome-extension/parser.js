(() => {
  const MISSING = "未提供";

  function decodeHtmlEntities(value) {
    const text = String(value ?? "");
    if (!text || typeof document === "undefined" || !document.createElement) {
      return text;
    }

    const textarea = document.createElement("textarea");
    textarea.innerHTML = text;
    return textarea.value;
  }

  function cleanInline(value) {
    if (!value) {
      return "";
    }

    return decodeHtmlEntities(value)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .trim();
  }

  function cleanMultiline(value) {
    if (!value) {
      return "";
    }

    return decodeHtmlEntities(value)
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  function nodeText(node) {
    const parts = [];

    function visit(current) {
      for (const child of current.childNodes || []) {
        if (child.nodeType === 3) {
          parts.push(child.nodeValue || "");
        } else if (child.nodeType === 1) {
          if (child.tagName.toLowerCase() === "br") {
            parts.push("\n");
          } else {
            visit(child);
          }
        }
      }
    }

    visit(node);
    return cleanMultiline(parts.join(""));
  }

  function firstText(nodes) {
    return nodes.length ? nodeText(nodes[0]) : "";
  }

  function firstAttr(root, selector, attribute) {
    const node = root.querySelector(selector);
    return node ? cleanInline(node.getAttribute(attribute)) : "";
  }

  function parseJsonLd(root) {
    for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
      let value;
      try {
        value = JSON.parse(script.textContent || "");
      } catch {
        continue;
      }

      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }

        const types = Array.isArray(item["@type"])
          ? item["@type"]
          : [item["@type"]];
        if (types.includes("JobPosting")) {
          return item;
        }
      }
    }

    return {};
  }

  function extractRows(root, sectionClass) {
    const rows = {};
    for (const section of root.querySelectorAll(`.${sectionClass}`)) {
      for (const row of section.querySelectorAll(".list-row")) {
        const head = row.querySelector(".list-row__head");
        const data = row.querySelector(".list-row__data");
        if (!head || !data) {
          continue;
        }

        const label = cleanInline(nodeText(head));
        let value;
        if (label === "職務類別") {
          const categories = data.querySelectorAll(".category-item");
          value = firstText(categories) || nodeText(data);
        } else {
          value = nodeText(data);
        }

        if (label && value && !(label in rows)) {
          rows[label] = value;
        }
      }
    }
    return rows;
  }

  function longestText(root, className) {
    let longest = "";
    for (const node of root.querySelectorAll(`.${className}`)) {
      const value = nodeText(node);
      if (value.length > longest.length) {
        longest = value;
      }
    }
    return longest;
  }

  function jsonValue(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => jsonValue(item))
        .filter(Boolean)
        .join(", ");
    }

    if (value && typeof value === "object") {
      if (value.value !== undefined && value.value !== null) {
        return jsonValue(value.value);
      }
      for (const key of [
        "name",
        "credentialCategory",
        "unitText",
        "monthsOfExperience",
      ]) {
        if (value[key] !== undefined && value[key] !== null) {
          return jsonValue(value[key]);
        }
      }
      return "";
    }

    return value === undefined || value === null ? "" : cleanInline(String(value));
  }

  function getAddress(job) {
    const location = job.jobLocation;
    const address = location && typeof location === "object" ? location.address : null;
    if (!address || typeof address !== "object" || Array.isArray(address)) {
      return "";
    }

    return cleanInline(
      [address.addressRegion, address.addressLocality, address.streetAddress]
        .filter(Boolean)
        .join(" "),
    );
  }

  function lastPathSegment(sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      const segments = url.pathname.split("/").filter(Boolean);
      return cleanInline(segments[segments.length - 1] || "");
    } catch {
      const path = cleanInline(sourceUrl).split(/[?#]/, 1)[0];
      const segments = path.split("/").filter(Boolean);
      return cleanInline(segments[segments.length - 1] || "");
    }
  }

  function getIdentifier(job, sourceUrl) {
    const identifier = job.identifier;
    if (identifier && typeof identifier === "object" && identifier.value) {
      return cleanInline(String(identifier.value));
    }
    return lastPathSegment(sourceUrl);
  }

  function extractHeader(root) {
    const header = longestText(root, "job-header");
    const result = {};
    const update = header.match(/\b\d{1,2}\/\d{1,2}更新\b/);
    const applicants = header.match(/應徵人數\s*([0-9]+\s*[~～-]\s*[0-9]+\s*人?)/);
    const handling = header.match(/\d+\s*天內處理過履歷/);

    if (update) {
      result["更新日期"] = update[0].replace(/更新$/, "");
    }
    if (applicants) {
      result["應徵人數"] = cleanInline(applicants[1]);
    }
    if (handling) {
      result["履歷處理速度"] = cleanInline(handling[0]);
    }
    return result;
  }

  function extractContact(root) {
    for (const row of root.querySelectorAll(".job-contact-table")) {
      const head = firstText(row.querySelectorAll(".job-contact-table__head"));
      if (head !== "聯絡人") {
        continue;
      }
      const value = firstText(row.querySelectorAll(".job-contact-table__data"));
      return cleanInline(value.split("104人力銀行提醒", 1)[0]);
    }
    return "";
  }

  function previousDiv(node) {
    let sibling = node.previousElementSibling;
    while (sibling && sibling.tagName !== "DIV") {
      sibling = sibling.previousElementSibling;
    }
    return sibling;
  }

  function extractBenefits(root) {
    const section = root.querySelector(".benefits");
    const result = {
      法定項目: [],
      其他福利: [],
      福利說明: "",
      應徵網址: "",
    };
    if (!section) {
      return result;
    }

    for (const row of section.querySelectorAll(".benefits-labels")) {
      const heading = previousDiv(row)?.querySelector("h3");
      const label = heading ? nodeText(heading) : "";
      const tags = Array.from(row.querySelectorAll('span[class*="tag"]'))
        .map((tag) => cleanInline(nodeText(tag)))
        .filter(Boolean);
      if (label in result) {
        result[label] = tags;
      }
    }

    result.福利說明 = longestText(section, "benefits-description");
    const url = section.querySelector('a[href*="recruit.asus.com"]');
    if (url) {
      result.應徵網址 = cleanInline(url.getAttribute("href"));
    } else {
      const textUrl = result.福利說明.match(/https?:\/\/[^\s<]+/);
      if (textUrl) {
        result.應徵網址 = textUrl[0].replace(/[.,)]+$/, "");
      }
    }

    return result;
  }

  function extractCompanyRating(root) {
    for (const node of root.querySelectorAll(".comment")) {
      const match = nodeText(node).match(/公司評價\s*([0-5](?:\.\d)?)/);
      if (match) {
        return match[1];
      }
    }
    return "";
  }

  function extractEnvironmentPhotoCount(root) {
    for (const node of root.querySelectorAll(".environment")) {
      const match = nodeText(node).match(/公司環境照片\s*\((\d+)張\)/);
      if (match) {
        return match[1];
      }
    }
    return "";
  }

  function canonicalUrl(value) {
    return cleanInline(value).split(/[?#]/, 1)[0];
  }

  function parseJob(root, sourceUrl = "") {
    const job = parseJsonLd(root);
    const rows = extractRows(root, "job-description");
    const requirementRows = extractRows(root, "job-requirement");
    for (const [key, value] of Object.entries(requirementRows)) {
      if (!(key in rows)) {
        rows[key] = value;
      }
    }

    const ogUrl = firstAttr(root, 'meta[property="og:url"]', "content");
    const source = canonicalUrl(ogUrl || job.url || sourceUrl);
    const organization =
      job.hiringOrganization && typeof job.hiringOrganization === "object"
        ? job.hiringOrganization
        : {};
    const companyUrl = cleanInline(String(organization.sameAs || ""));

    let title = cleanInline(String(job.title || ""));
    if (!title) {
      title = firstText(root.querySelectorAll("h1"));
    }
    if (!title) {
      throw new Error("找不到職缺標題或 JobPosting 資料");
    }

    const benefits = extractBenefits(root);
    const header = extractHeader(root);
    const experienceRequirements = job.experienceRequirements;
    const months =
      experienceRequirements && typeof experienceRequirements === "object"
        ? experienceRequirements.monthsOfExperience
        : undefined;
    const companyLink = root.querySelector('a[href*="/company/"]');

    let experience = rows["工作經歷"] || "";
    if (!experience && months) {
      const years = Math.floor(Number(months) / 12);
      if (Number.isFinite(years)) {
        experience = `${years}年以上`;
      }
    }

    let employmentType = rows["工作性質"] || "";
    if (!employmentType && jsonValue(job.employmentType).includes("FULL_TIME")) {
      employmentType = "全職";
    }

    return {
      title,
      job_id: getIdentifier(job, source),
      company: cleanInline(String(organization.name || "")) ||
        (companyLink ? cleanInline(nodeText(companyLink)) : ""),
      company_url: companyUrl,
      industry: cleanInline(String(job.industry || "")),
      salary: rows["工作待遇"] || jsonValue(job.baseSalary),
      employment_type: employmentType,
      location:
        rows["上班地點"] || firstText(root.querySelectorAll(".job-address")) || getAddress(job),
      remote_work: rows["遠端工作"] || "未標示",
      work_hours: rows["上班時段"] || jsonValue(job.workHours),
      management: rows["管理責任"] || "",
      business_trip: rows["出差外派"] || "",
      vacation_policy: rows["休假制度"] || "",
      start_working_day: rows["可上班日"] || "",
      headcount: rows["需求人數"] || "",
      experience,
      education: rows["學歷要求"] || jsonValue(job.educationRequirements),
      department: rows["科系要求"] || "",
      language: rows["語文條件"] || "",
      tools: rows["擅長工具"] || "",
      skills: rows["工作技能"] || "",
      other_conditions: rows["其他條件"] || "",
      description: longestText(root, "job-description__content"),
      contact: extractContact(root),
      benefits,
      date_posted: cleanInline(String(job.datePosted || "")),
      valid_through: cleanInline(String(job.validThrough || "")),
      header,
      company_rating: extractCompanyRating(root),
      environment_photos: extractEnvironmentPhotoCount(root),
      source_url: source,
    };
  }

  function parseJobSummary(node, sourceUrl = "") {
    const jobLink = node.querySelector('.info-job__text, a[data-gtm-joblist="職缺-職缺名稱"]');
    const href = jobLink ? jobLink.getAttribute("href") : "";
    const match = href ? href.match(/\/job\/([^/?#]+)/) : null;
    const jobId = match ? match[1] : (cleanInline(node.getAttribute("data-job-no")) || "");

    const title = jobLink
      ? cleanInline(jobLink.getAttribute("title") || nodeText(jobLink))
      : "";

    const compLink = node.querySelector('.info-company__text, a[data-gtm-joblist="職缺-公司名稱"]');
    const company = compLink ? cleanInline(nodeText(compLink)) : "";
    const compHref = compLink ? compLink.getAttribute("href") : "";

    const indEl = node.querySelector('.info-company-addon-type, [data-gtm-joblist^="職缺-產業-"]');
    const industry = indEl ? cleanInline(nodeText(indEl)) : "";

    let location = "";
    let experience = "";
    let education = "";
    let salary = "";

    for (const tag of node.querySelectorAll(
      '.info-tags .info-tags__text, [data-gtm-joblist^="職缺-地區-"], [data-gtm-joblist^="職缺-經歷-"], [data-gtm-joblist^="職缺-學歷-"], [data-gtm-joblist^="職缺-薪資-"]',
    )) {
      const gtm =
        tag.getAttribute("data-gtm-joblist") ||
        tag.querySelector("[data-gtm-joblist]")?.getAttribute("data-gtm-joblist") ||
        "";
      const text = cleanInline(nodeText(tag));
      if (!text) continue;

      if (gtm.startsWith("職缺-地區-")) {
        location = text;
      } else if (gtm.startsWith("職缺-經歷-")) {
        experience = text;
      } else if (gtm.startsWith("職缺-學歷-")) {
        education = text;
      } else if (gtm.startsWith("職缺-薪資-")) {
        salary = text;
      } else if (!location && /市|縣|區|鄉|鎮/.test(text)) {
        location = text;
      } else if (!salary && /薪|待遇|面議/.test(text)) {
        salary = text;
      } else if (!experience && /經歷|年/.test(text)) {
        experience = text;
      } else if (!education && /專科|大學|碩士|博士|高中|不拘/.test(text)) {
        education = text;
      }
    }

    const otherTags = [];
    for (const t of node.querySelectorAll(
      '.info-othertags span, .c-guideline__label span, [data-gtm-joblist^="職缺-標籤-"]',
    )) {
      const tagText = cleanInline(nodeText(t));
      if (tagText && !otherTags.includes(tagText)) {
        otherTags.push(tagText);
      }
    }

    let jobUrl = "";
    if (href) {
      try {
        jobUrl = canonicalUrl(new URL(href, "https://www.104.com.tw").href);
      } catch {
        jobUrl = canonicalUrl(href);
      }
    } else if (jobId) {
      jobUrl = `https://www.104.com.tw/job/${jobId}`;
    }

    let companyUrl = "";
    if (compHref) {
      try {
        companyUrl = canonicalUrl(new URL(compHref, "https://www.104.com.tw").href);
      } catch {
        companyUrl = canonicalUrl(compHref);
      }
    }

    const dateContainer = node.querySelector(".date-container");
    const date = dateContainer ? cleanInline(nodeText(dateContainer)) : "";

    const applyRange = node.querySelector('.action-apply__range, [data-gtm-joblist="職缺-應徵分析"]');
    const applicants = applyRange ? cleanInline(nodeText(applyRange)) : "";

    return {
      job_id: jobId,
      title,
      company,
      company_url: companyUrl,
      industry,
      location,
      experience,
      education,
      salary,
      description: longestText(node, "info-description"),
      other_tags: otherTags,
      date,
      applicants,
      source_url: jobUrl,
    };
  }

  function parseJobListMeta(root, sourceUrl = "") {
    let keyword = "";
    try {
      const u = new URL(sourceUrl, "https://www.104.com.tw");
      keyword = cleanInline(u.searchParams.get("keyword") || "");
    } catch {}
    if (!keyword) {
      const input = root.querySelector('.search input[type="text"], input[data-gtm-joblist="搜尋欄位-關鍵字"]');
      keyword = input ? cleanInline(input.value) : "";
    }
    if (!keyword) {
      const titleMatch = (root.title || "").match(/「([^」]+)」/);
      if (titleMatch) keyword = cleanInline(titleMatch[1]);
    }
    if (!keyword) {
      keyword = "全部工作";
    }

    let page = "";
    try {
      const u = new URL(sourceUrl, "https://www.104.com.tw");
      page = cleanInline(u.searchParams.get("page") || "");
    } catch {}
    if (!page) {
      const pageEl = root.querySelector('.order__page__select .h4, [data-gtm-joblist="排序列-頁碼"] .h4');
      const match = pageEl ? cleanInline(nodeText(pageEl)).match(/\d+/) : null;
      page = match ? match[0] : "1";
    }

    const countEl = root.querySelector('.order__count span, .header__order .t4');
    const totalCount = countEl ? cleanInline(nodeText(countEl)) : "";

    return {
      keyword,
      page,
      total_count: totalCount,
      source_url: canonicalUrl(sourceUrl || (globalThis.location?.href || "")),
    };
  }

  function parseJobList(root, sourceUrl = "") {
    const meta = parseJobListMeta(root, sourceUrl);
    const jobs = [];
    const seen = new Set();
    for (const item of root.querySelectorAll(".job-summary")) {
      const job = parseJobSummary(item, sourceUrl);
      const key = job.job_id || job.title;
      if (key && !seen.has(key)) {
        seen.add(key);
        jobs.push(job);
      }
    }
    return {
      type: "search",
      keyword: meta.keyword,
      page: meta.page,
      total_count: meta.total_count,
      source_url: meta.source_url,
      jobs,
    };
  }

  async function collectAllListJobs(root, sourceUrl = "") {
    const jobsMap = new Map();

    function scan() {
      for (const item of root.querySelectorAll(".job-summary")) {
        try {
          const job = parseJobSummary(item, sourceUrl);
          const key = job.job_id || job.title;
          if (key && !jobsMap.has(key)) {
            jobsMap.set(key, job);
          }
        } catch {}
      }
    }

    scan();

    if (
      typeof window !== "undefined" &&
      typeof window.scrollTo === "function" &&
      root === document &&
      root.querySelector(".vue-recycle-scroller")
    ) {
      const originalY = window.scrollY;
      const maxScroll = Math.max(
        document.body.scrollHeight || 0,
        document.documentElement.scrollHeight || 0,
        3000,
      );
      const step = window.innerHeight || 800;

      for (let pos = 0; pos <= maxScroll; pos += step) {
        window.scrollTo(0, pos);
        await new Promise((resolve) => setTimeout(resolve, 80));
        scan();
      }

      window.scrollTo(0, originalY);
    }

    const meta = parseJobListMeta(root, sourceUrl);
    return {
      type: "search",
      keyword: meta.keyword,
      page: meta.page,
      total_count: meta.total_count,
      source_url: meta.source_url,
      jobs: Array.from(jobsMap.values()),
    };
  }

  globalThis.__parse104Job = parseJob;
  globalThis.__parse104JobList = parseJobList;
  globalThis.__104Parser = { parseJob, parseJobList };

  if (typeof document === "undefined" || !document.querySelectorAll) {
    return null;
  }

  async function run() {
    try {
      const currentUrl = globalThis.location?.href || "";
      const isSearch =
        /\/jobs\/search\b/i.test(currentUrl) ||
        Boolean(document.querySelector(".job-summary") && !document.querySelector(".job-description"));

      if (isSearch) {
        return await collectAllListJobs(document, currentUrl);
      }
      return parseJob(document, currentUrl);
    } catch (error) {
      return {
        __error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return run();
})();
