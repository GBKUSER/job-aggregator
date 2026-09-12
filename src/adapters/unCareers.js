const { XMLParser } = require('fast-xml-parser');

const FEED_URL = 'https://careers.un.org/jobfeed?isPage=true&language=en';
const DETAIL_BASE = 'https://careers.un.org/jobSearchDescription';

function cleanText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function parseDateLoose(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function fieldsFromText(text) {
  const lines = cleanText(text).split('\n').map(v => v.trim()).filter(Boolean);
  const fields = {};
  const labels = [
    ['level', /^Level\s*:\s*(.*)$/i],
    ['external_id', /^Job ID\s*:\s*(.*)$/i],
    ['job_network', /^Job Network\s*:\s*(.*)$/i],
    ['job_family', /^Job Family\s*:\s*(.*)$/i],
    ['category', /^(?:Category(?: and Level)?)\s*:\s*(.*)$/i],
    ['recruitment_type', /^Recruitment Type\s*:\s*(.*)$/i],
    ['organization', /^Department\/Office\s*:\s*(.*)$/i],
    ['location', /^Duty Station\s*:\s*(.*)$/i],
    ['date_posted', /^Date Posted\s*:\s*(.*)$/i],
    ['deadline', /^Deadline\s*:\s*(.*)$/i],
  ];

  for (const line of lines) {
    for (const [key, regex] of labels) {
      const m = line.match(regex);
      if (m && !fields[key]) fields[key] = m[1].trim() || null;
    }
  }
  return fields;
}

function parseHtmlPage(html) {
  const text = cleanText(html);
  const lines = text.split('\n').map(v => v.trim()).filter(Boolean);
  const jobs = [];
  let current = null;

  const knownLabel = /^(Level|Job ID|Job Network|Job Family|Category(?: and Level)?|Recruitment Type|Department\/Office|Duty Station|Staffing Exercise|Date Posted|Deadline)\s*:/i;
  const boilerplate = /^(Welcome to|This is the main content|United Nations Job Openings|You are viewing|You can click here|Job openings are automatically)/i;

  for (const line of lines) {
    if (boilerplate.test(line)) continue;

    if (!knownLabel.test(line)) {
      if (current && current.external_id) {
        jobs.push(current);
        current = { title: line };
      } else if (!current || !current.title) {
        current = { title: line };
      }
      continue;
    }

    if (!current) current = {};
    const parsed = fieldsFromText(line);
    Object.assign(current, parsed);
  }
  if (current && current.external_id) jobs.push(current);

  return jobs.filter(j => j.external_id && j.title);
}

function parseXmlFeed(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '#cdata' });
  const doc = parser.parse(xml);
  let items = doc?.rss?.channel?.item || doc?.feed?.entry || [];
  if (!Array.isArray(items)) items = [items];

  return items.map(item => {
    const description = item.description?.['#cdata'] || item.description || item.summary?.['#text'] || item.summary || '';
    const fields = fieldsFromText(description);
    const title = cleanText(item.title?.['#text'] || item.title || fields.title || '');
    const guid = String(item.guid?.['#text'] || item.guid || '');
    const idMatch = `${description} ${guid} ${item.link || ''}`.match(/(?:Job ID\s*:\s*|jobSearchDescription\/)(\d{4,})/i);
    const external_id = fields.external_id || (idMatch ? idMatch[1] : null);
    return { title, external_id, ...fields };
  }).filter(j => j.external_id && j.title);
}

async function fetchUnCareers() {
  const response = await fetch(FEED_URL, {
    headers: {
      'user-agent': 'UNCareersHub/1.0 (+https://uncareershub.org)',
      accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`UN Careers feed HTTP ${response.status}`);
  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';

  let jobs = [];
  if (/xml|rss|atom/i.test(contentType) || /^\s*<\?xml/i.test(body) || /<rss[\s>]/i.test(body)) {
    jobs = parseXmlFeed(body);
  }
  if (!jobs.length) jobs = parseHtmlPage(body);
  if (!jobs.length) throw new Error('UN Careers parser returned zero jobs; refusing reconciliation');

  return jobs.map(job => ({
    source: 'un_careers',
    external_id: String(job.external_id).trim(),
    title: job.title,
    organization: job.organization || 'United Nations',
    location: job.location || null,
    country: null,
    date_posted: parseDateLoose(job.date_posted),
    deadline: parseDateLoose(job.deadline),
    url: `${DETAIL_BASE}/${encodeURIComponent(job.external_id)}?language=en`,
    apply_url: 'https://careers.un.org/jobopening?language=en',
    description: null,
    raw_json: {
      level: job.level || null,
      job_network: job.job_network || null,
      job_family: job.job_family || null,
      category: job.category || null,
      recruitment_type: job.recruitment_type || null,
      department_office: job.organization || null,
      duty_station: job.location || null,
      date_posted_raw: job.date_posted || null,
      deadline_raw: job.deadline || null,
    },
  }));
}

module.exports = { fetchUnCareers, parseHtmlPage, parseXmlFeed };
