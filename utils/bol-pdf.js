const LIABILITY_ACKNOWLEDGMENT =
  'LIABILITY ACKNOWLEDGMENT: BY SIGNING ABOVE AND/OR ACCEPTING POSSESSION OF THE LOAD, DRIVER AND CARRIER ACKNOWLEDGE THAT THE MATERIALS HAVE BEEN LOADED BY THE RAILROAD IN APPARENT GOOD ORDER AND CONDITION, UNLESS OTHERWISE NOTED AT THE TIME OF LOADING. FROM THAT MOMENT FORWARD, DRIVER AND CARRIER ASSUME FULL AND EXCLUSIVE RESPONSIBILITY AND LIABILITY FOR THE CUSTODY, SECUREMENT, TRANSPORT, AND DELIVERY OF THE MATERIALS. THE RAILROAD SHALL HAVE NO LIABILITY FOR ANY LOSS, DAMAGE, CONTAMINATION, SPILLAGE, DELAY, OR CLAIM OF ANY KIND ARISING AFTER DRIVER ACCEPTS THE LOAD, REGARDLESS OF CAUSE. CARRIER AGREES TO INDEMNIFY, DEFEND, AND HOLD HARMLESS THE RAILROAD, ITS AFFILIATES, AND EMPLOYEES FROM ANY AND ALL SUCH CLAIMS, DAMAGES, OR EXPENSES.';

const clean = (value) =>
  String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatAddress = (entity = {}, fields = []) => fields.map((field) => entity?.[field]).filter(Boolean).join(', ');
const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleString();
};

const buildBolPrintHtml = ({ bol, order, customer, receiver, project, material }) => {
  const customerAddress = formatAddress(customer, [
    'customerAddress1',
    'customerAddress2',
    'customerCity',
    'customerState',
    'customerZip',
  ]) || 'N/A';
  const receiverAddress = project?.fullAddress || formatAddress(receiver, [
    'billingAddress1',
    'billingAddress2',
    'billingCity',
    'billingState',
    'billingZip',
  ]) || 'N/A';

  const isSplitLoad = Boolean(bol?.splitLoad && bol?.secondaryRailcarID);
  const primaryNetWeight = bol?.primaryNetWeight ?? bol?.netWeight;
  const primaryTonWeight = bol?.primaryTonWeight ?? (primaryNetWeight != null ? Number(primaryNetWeight) / 2000 : null);
  const orderNo = order?.orderNumber || 'N/A';

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>BOL ${clean(orderNo)}</title>
        <style>
          @page { size: auto; margin: 0.35in; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; margin: 0; color: #1f2937; font-size: 12px; line-height: 1.25; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
          .title-wrap h2 { margin: 0 0 2px 0; font-size: 18px; }
          .meta { font-size: 11px; color: #4b5563; margin: 1px 0; }
          .logo { max-height: 52px; max-width: 170px; object-fit: contain; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
          .card { border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 8px; }
          .card h3 { margin: 0 0 4px 0; font-size: 12px; color: #111827; }
          .card p { margin: 2px 0; font-size: 11px; }
          .signature-wrap { margin-top: 8px; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 8px; }
          .signature-wrap h3 { margin: 0 0 4px 0; font-size: 12px; color: #111827; }
          .signature-meta { font-size: 11px; margin-bottom: 4px; }
          .signature-image { max-width: 250px; max-height: 70px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; }
          .disclaimer { margin-top: 8px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 9px; line-height: 1.25; color: #374151; background: #f9fafb; }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; }
          th, td { border: 1px solid #d1d5db; padding: 5px 6px; text-align: left; font-size: 11px; }
          th { background: #f9fafb; width: 30%; }
          .details-grid { display: grid; grid-template-columns: ${isSplitLoad ? '1fr 1fr' : '1fr'}; gap: 8px; margin-top: 6px; }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
          .split-col h3 { margin: 3px 0 0 0; font-size: 12px; color: #111827; }
          .totals-table { margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title-wrap">
            <h2>BOL ${clean(orderNo)}</h2>
            <div class="meta">Date: ${clean(formatDateTime(bol?.bolDate))}</div>
            <div class="meta">Status: ${clean(bol?.status || 'Draft')}</div>
          </div>
          ${customer?.customerLogo ? `<img class="logo" src="${clean(customer.customerLogo)}" alt="Customer Logo" />` : ''}
        </div>

        <div class="grid">
          <div class="card">
            <h3>Customer</h3>
            <p><strong>Name:</strong> ${clean(customer?.customerName || 'N/A')}</p>
            <p><strong>Address:</strong> ${clean(customerAddress)}</p>
            <p><strong>Origin:</strong> West Tennessee Railroad, 1061 James Buchanan Dr, Jackson, TN 38301</p>
          </div>
          <div class="card">
            <h3>Receiver / Delivery</h3>
            <p><strong>Receiver:</strong> ${clean(receiver?.receiverName || 'N/A')}</p>
            <p><strong>Location:</strong> ${clean(project?.projectName || 'N/A')}</p>
            <p><strong>Address:</strong> ${clean(receiverAddress)}</p>
          </div>
        </div>

        <div class="meta-grid">
          <table>
            <tr><th>Order Number</th><td>${clean(orderNo)}</td></tr>
            <tr><th>Material</th><td>${clean(material?.materialName || 'N/A')}</td></tr>
          </table>
          <table>
            <tr><th>Split Load</th><td>${isSplitLoad ? 'Yes' : 'No'}</td></tr>
            <tr><th>Truck / Trailer</th><td>${clean(bol?.truckID || 'N/A')} / ${clean(bol?.trailerID || 'N/A')}</td></tr>
          </table>
        </div>

        <div class="details-grid">
          <div class="split-col">
            <h3>Primary Load</h3>
            <table>
              <tr><th>Railcar ID</th><td>${clean(bol?.railcarID || 'N/A')}</td></tr>
              <tr><th>Gross Weight</th><td>${clean(bol?.grossWeight ?? 'N/A')}</td></tr>
              <tr><th>Tare Weight</th><td>${clean(bol?.tareWeight ?? 'N/A')}</td></tr>
              <tr><th>Net Weight</th><td>${clean(primaryNetWeight ?? 'N/A')}</td></tr>
              <tr><th>Ton Weight</th><td>${clean(primaryTonWeight ?? 'N/A')}</td></tr>
            </table>
          </div>
          ${
            isSplitLoad
              ? `
            <div class="split-col">
              <h3>Secondary Load</h3>
              <table>
                <tr><th>Railcar ID</th><td>${clean(bol?.secondaryRailcarID || 'N/A')}</td></tr>
                <tr><th>Gross Weight</th><td>${clean(bol?.secondaryGrossWeight ?? 'N/A')}</td></tr>
                <tr><th>Tare Weight</th><td>${clean(bol?.secondaryTareWeight ?? 'N/A')}</td></tr>
                <tr><th>Net Weight</th><td>${clean(bol?.secondaryNetWeight ?? 'N/A')}</td></tr>
                <tr><th>Ton Weight</th><td>${clean(bol?.secondaryTonWeight ?? 'N/A')}</td></tr>
              </table>
            </div>
          `
              : ''
          }
        </div>

        <table class="totals-table">
          <tr><th>Total Net Weight</th><td>${clean(bol?.netWeight ?? 'N/A')}</td></tr>
          <tr><th>Total Ton Weight</th><td>${clean(bol?.tonWeight ?? 'N/A')}</td></tr>
        </table>

        <div class="signature-wrap">
          <h3>Driver Signature</h3>
          <div class="signature-meta"><strong>Driver:</strong> ${clean(bol?.driverName || 'N/A')}</div>
          <div class="signature-meta"><strong>Signed At:</strong> ${clean(formatDateTime(bol?.signedAt))}</div>
          ${
            bol?.driverSignatureImage
              ? `<img class="signature-image" src="${clean(bol.driverSignatureImage)}" alt="Driver Signature" />`
              : '<div class="signature-meta">No signature on file</div>'
          }
        </div>

        <div class="disclaimer">${clean(LIABILITY_ACKNOWLEDGMENT)}</div>
      </body>
    </html>
  `;
};

const escapePdfText = (value) =>
  String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');

const buildSimpleFallbackPdf = (lines = []) => {
  const streamLines = ['BT', '/F1 10 Tf'];
  const startY = 770;
  const lineHeight = 14;

  lines.slice(0, 48).forEach((line, idx) => {
    const y = startY - idx * lineHeight;
    streamLines.push(`1 0 0 1 44 ${y} Tm`);
    streamLines.push(`(${escapePdfText(line)}) Tj`);
  });
  streamLines.push('ET');
  const stream = `${streamLines.join('\n')}\n`;

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
};

const renderPdfFromHtml = async (html) => {
  const puppeteer = require('puppeteer');
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' },
    });
    return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  } finally {
    await browser.close();
  }
};

const buildBolPdfAttachment = async ({ bol, order, customer, receiver, project, material, shipper }) => {
  const orderNumber = order?.orderNumber || 'N/A';
  const sanitizedOrder = String(orderNumber).replace(/[^a-zA-Z0-9_-]/g, '-');
  const html = buildBolPrintHtml({ bol, order, customer, receiver, project, material, shipper });

  let pdfBuffer;
  try {
    pdfBuffer = await renderPdfFromHtml(html);
  } catch (err) {
    console.error('Falling back to simple BOL PDF generation:', err?.message || err);
    pdfBuffer = buildSimpleFallbackPdf([
      'Tennessee Rail Systems - Completed Bill of Lading',
      `Order Number: ${orderNumber}`,
      `BOL ID: ${bol?._id || 'N/A'}`,
      `Customer: ${customer?.customerName || 'N/A'}`,
      `Material: ${material?.materialName || 'N/A'}`,
      `Railcar: ${bol?.railcarID || 'N/A'}`,
      `Truck / Trailer: ${bol?.truckID || 'N/A'} / ${bol?.trailerID || 'N/A'}`,
      `Total Net Weight: ${bol?.netWeight ?? 'N/A'}`,
      `Total Ton Weight: ${bol?.tonWeight ?? 'N/A'}`,
      `Completed At: ${formatDateTime(bol?.completedAt || bol?.weighOutTime)}`,
      '',
      'Install puppeteer in backend runtime for print-identical PDF output.',
    ]);
  }

  return {
    filename: `BOL-${sanitizedOrder || 'N-A'}.pdf`,
    content: pdfBuffer,
    contentType: 'application/pdf',
  };
};

module.exports = {
  buildBolPdfAttachment,
  buildBolPrintHtml,
};
