import type { EngagementReportRow } from '@/lib/command-center-analytics';

type EngagementReportPdfOptions = {
  title: string;
  subtitle?: string;
  summary?: string[];
  generatedAt?: Date;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 42;
const TOP_Y = 746;
const BOTTOM_Y = 54;
const LINE_HEIGHT = 14;

const cleanPdfText = (value: unknown) =>
  String(value ?? '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();

const escapePdfText = (value: unknown) =>
  cleanPdfText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

const truncateText = (value: unknown, maxLength: number) => {
  const text = cleanPdfText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const byteLength = (value: string) => new TextEncoder().encode(value).length;

const text = ({
  x,
  y,
  size,
  value,
  font = 'F1',
  color = '0.10 0.13 0.12',
}: {
  x: number;
  y: number;
  size: number;
  value: unknown;
  font?: 'F1' | 'F2';
  color?: string;
}) => `q ${color} rg BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(value)}) Tj ET Q\n`;

const line = (y: number, color = '0.84 0.88 0.84') =>
  `q ${color} RG 0.6 w ${MARGIN_X.toFixed(2)} ${y.toFixed(2)} m ${(PAGE_WIDTH - MARGIN_X).toFixed(2)} ${y.toFixed(2)} l S Q\n`;

const formatGeneratedAt = (date: Date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

export const buildEngagementReportPdf = (
  rows: EngagementReportRow[],
  {
    title,
    subtitle = 'Caspo Command Center Report',
    summary = [],
    generatedAt = new Date(),
  }: EngagementReportPdfOptions
) => {
  const pages: string[] = [];
  let page = '';
  let cursorY = TOP_Y;
  let pageNumber = 0;

  const startPage = () => {
    if (page) {
      pages.push(page);
    }
    pageNumber += 1;
    page = '';
    cursorY = TOP_Y;
    page += text({ x: MARGIN_X, y: cursorY, size: 18, value: title, font: 'F2', color: '0.02 0.22 0.14' });
    cursorY -= 18;
    page += text({ x: MARGIN_X, y: cursorY, size: 10, value: subtitle, color: '0.34 0.39 0.36' });
    page += text({
      x: PAGE_WIDTH - 210,
      y: cursorY,
      size: 9,
      value: `Generated ${formatGeneratedAt(generatedAt)}`,
      color: '0.34 0.39 0.36',
    });
    cursorY -= 18;
    page += line(cursorY);
    cursorY -= 18;
  };

  const ensureSpace = (neededHeight: number) => {
    if (cursorY - neededHeight < BOTTOM_Y) {
      page += text({
        x: PAGE_WIDTH - 92,
        y: 28,
        size: 8,
        value: `Page ${pageNumber}`,
        color: '0.45 0.50 0.47',
      });
      startPage();
    }
  };

  startPage();

  if (summary.length > 0) {
    page += text({ x: MARGIN_X, y: cursorY, size: 11, value: 'Summary', font: 'F2', color: '0.08 0.18 0.13' });
    cursorY -= LINE_HEIGHT;
    summary.forEach(item => {
      ensureSpace(LINE_HEIGHT);
      page += text({ x: MARGIN_X, y: cursorY, size: 9.5, value: item, color: '0.22 0.27 0.24' });
      cursorY -= LINE_HEIGHT;
    });
    cursorY -= 8;
  }

  page += text({ x: MARGIN_X, y: cursorY, size: 11, value: 'Group Metrics', font: 'F2', color: '0.08 0.18 0.13' });
  cursorY -= LINE_HEIGHT;

  if (rows.length === 0) {
    page += text({ x: MARGIN_X, y: cursorY, size: 9.5, value: 'No report rows are available yet.', color: '0.34 0.39 0.36' });
    cursorY -= LINE_HEIGHT;
  }

  rows.forEach((row, index) => {
    ensureSpace(52);
    page += line(cursorY + 4, '0.90 0.92 0.90');
    page += text({
      x: MARGIN_X,
      y: cursorY - 10,
      size: 10.5,
      value: `${index + 1}. ${truncateText(row.groupName, 56)}`,
      font: 'F2',
      color: '0.06 0.11 0.09',
    });
    page += text({
      x: 340,
      y: cursorY - 10,
      size: 9,
      value: truncateText(row.orgName, 38),
      color: '0.34 0.39 0.36',
    });
    cursorY -= 26;
    page += text({
      x: MARGIN_X,
      y: cursorY,
      size: 8.8,
      value: `Members ${row.activeMembers} | Status ${row.status} | Compliance ${row.compliant} | Hours ${row.resourceHours} | AI Tasks ${row.tasksAutomated}`,
      color: '0.18 0.23 0.20',
    });
    cursorY -= LINE_HEIGHT;
    page += text({
      x: MARGIN_X,
      y: cursorY,
      size: 8.8,
      value: `Sponsor ${truncateText(row.sponsor || 'Missing', 44)} | Last Activity ${row.lastActivityDate || 'No activity'}`,
      color: '0.34 0.39 0.36',
    });
    cursorY -= 18;
  });

  page += text({
    x: PAGE_WIDTH - 92,
    y: 28,
    size: 8,
    value: `Page ${pageNumber}`,
    color: '0.45 0.50 0.47',
  });
  pages.push(page);

  const pageObjectsStart = 5;
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
  ];
  const pageObjectNumbers = pages.map((_, index) => pageObjectsStart + index * 2);
  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`;

  pages.forEach((content, index) => {
    const pageObjectNumber = pageObjectsStart + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    objects.push(
      `${pageObjectNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentObjectNumber} 0 obj\n<< /Length ${byteLength(content)} >>\nstream\n${content}endstream\nendobj\n`
    );
  });

  let pdf = '%PDF-1.4\n';
  let position = byteLength(pdf);
  const offsets: number[] = [];
  objects.forEach(object => {
    offsets.push(position);
    pdf += object;
    position += byteLength(object);
  });

  const xrefOffset = position;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
};
