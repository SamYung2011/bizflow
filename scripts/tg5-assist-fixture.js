// Local-only transport fixture. Every unrecognised API request fails closed.
const now = Date.UTC(2026, 9, 19, 4, 0);
const user = { id: 801, nickname: 'Sophie Wong', email: 'sophie@example.test', phoneHk: '66001002', phoneCn: '13800138000' };
const record = (id, customer = user) => ({ id, caseNo: `HM-NB-${String(id).padStart(6,'0')}`, kind: 'first', status: 'draft', result: null,
  applicant: { name: customer.nickname, phoneHk: customer.phoneHk, phoneCn: customer.phoneCn, addressHk: '' },
  vehicle: { carId: 51, plateNo: 'AB 1234', brand: 'BYD', model: 'Seal', color: '' }, driverMode: '1+1', persons: [],
  documents: [], events: [], pendingRequests: [], requiredDocs: ['vehicle_license','cn_driving_license','hrp','driver_doc'],
  createdAt: now, updatedAt: now, submittedAt: null, user: customer, pendingRequestCount: 0 });
export function installAssistFixture() {
  const cases = [Object.assign(record(71), { status:'checking', submittedAt:now-86400000,
    pendingRequests:[{requestId:'NB-DOC-001',kinds:['hrp'],note:'Clear photo'}],pendingRequestCount:1 })];
  let next = 900, fileId = 1, docId = 1; const files = new Map();
  const sampleDocs = [];
  if (new URLSearchParams(location.search).has('files')) {
    function photo(width, height) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#edf2fb'; ctx.fillRect(0,0,width,height);
      ctx.fillStyle = '#fff'; ctx.fillRect(width*.06,height*.08,width*.88,height*.84);
      ctx.fillStyle = '#334777'; ctx.font = `${width*.055}px sans-serif`;
      ctx.fillText('VEHICLE REGISTRATION',width*.13,height*.3);
      ctx.font = `${width*.09}px sans-serif`; ctx.fillText('AB 1234',width*.13,height*.57);
      ctx.fillStyle = '#7a889e'; ctx.font = `${width*.033}px sans-serif`;
      ctx.fillText('LOCAL TEST DOCUMENT',width*.13,height*.76);
      return new Blob([Uint8Array.from(atob(canvas.toDataURL('image/jpeg').split(',')[1]),c=>c.charCodeAt(0))],{type:'image/jpeg'});
    }
    const original = photo(2400,1500), thumb = photo(480,300);
    files.set('vehicle-original',{blob:original}); files.set('vehicle-thumb',{blob:thumb});
    const stream = 'BT /F1 18 Tf 40 200 Td (LOCAL TEST DOCUMENT) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
    const xref = pdf.length;
    pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    files.set('proof-original',{blob:new Blob([pdf],{type:'application/pdf'})});
    files.set('no-thumb-original',{blob:original});
    sampleDocs.push({id:101,cfid:'vehicle-original',thumbCfid:'vehicle-thumb',name:'vehicle.jpg',mime:'image/jpeg',size:original.size,kind:'vehicle_license'},
      {id:102,cfid:'proof-original',name:'proof.pdf',mime:'application/pdf',size:20480,kind:'hrp'},
      {id:103,cfid:'no-thumb-original',name:'legacy.jpg',mime:'image/jpeg',size:original.size,kind:'driver_doc'});
    sampleDocs.forEach(doc=>Object.assign(doc,{version:1,status:'uploaded',createdAt:now,requestId:'NB-DOC-001'}));
    if (new URLSearchParams(location.search).has('statuses')) {
      Object.assign(sampleDocs[0], {version:2,status:'accepted'});
      Object.assign(sampleDocs[1], {version:3,status:'rejected',staffNote:'Unclear scan'});
      Object.assign(sampleDocs[2], {version:1,status:'removed',staffNote:'Superseded document'});
      sampleDocs.push({...sampleDocs[0],id:104,name:'new-version.jpg',version:4,status:'uploaded'});
    }
    cases[0].documents = structuredClone(sampleDocs);
  }
  const calls = []; window.__assistCalls = calls;
  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), location.origin), method = init.method || 'GET';
    if (url.origin !== 'https://fixture.invalid') throw new Error(`Unexpected fixture network: ${url.origin}`);
    const path = url.pathname.replace('/functions/v1/honnmono-admin','');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ path, method, body: body instanceof Blob ? {size:body.size,type:body.type} : body });
    const ok = result => Response.json({code:0,result});
    if (/^\/support\/upload\//.test(path)) { files.get(path.split('/').at(-1)).blob = body; return ok({}); }
    if (/^\/northbound\/files\//.test(path)) { const saved = files.get(path.split('/')[3]); return new Response(saved?.blob || new Blob(['fixture'],{type:'application/pdf'})); }
    if (path==='/northbound/cases') return ok({ items:cases.filter(row=>row.submittedAt), total:cases.filter(row=>row.submittedAt).length, page:1,size:30 });
    let match = path.match(/^\/northbound\/assist\/users\/(\d+)\/cases$/);
    if (match) {
      const userid = Number(match[1]);
      if (method==='GET') return ok(cases.filter(row=>row.user.id===userid));
      const previous = cases.find(row=>row.user.id===userid && row.status==='draft');
      if (previous) return ok({...previous,existing:true});
      const customer = {id:userid,nickname:'Alex Chan',email:'alex@example.test',phoneHk:'66001001',phoneCn:'13800138000'};
      const row = { ...record(next++,customer), kind:body.kind, documents:structuredClone(sampleDocs) };cases.push(row);return ok({...row,existing:false});
    }
    match = path.match(/^\/northbound\/(?:assist\/)?cases\/(\d+)(.*)$/);
    if (match) {
      const row = cases.find(row=>row.id===Number(match[1])), action = match[2];
      if (!row) return Response.json({code:404},{status:404});
      if (!action) return ok(row);
      if (/^\/documents\/\d+\/review$/.test(action)) { const doc=row.documents.find(item=>item.id===Number(action.split('/')[2]));Object.assign(doc,{status:body.status,staffNote:body.note});return ok(doc); }
      if (action==='/update') { Object.assign(row,body,{persons:body.persons.map((person,index)=>({...person,id:index+1,sort:index}))}); return ok(row); }
      if (action==='/upload') return ok({filelist:body.filelist.map(item=>{const cfid=`assist-file-${fileId++}`;files.set(cfid,item);return{...item,cfid,cfinfo:{url:`/functions/v1/honnmono-admin/support/upload/${cfid}`,method:'POST'}};})});
      if (action==='/documents') { const file=files.get(body.cfid);const doc={...body,id:docId++,name:file.filename,mime:file.mime,size:file.size,status:'uploaded',version:1,createdAt:now};row.documents.push(doc);return ok(doc); }
      if (/^\/documents\/\d+\/remove$/.test(action)) { const doc=row.documents.find(item=>item.id===Number(action.split('/')[2]));doc.status='removed';return ok(doc); }
      if (action==='/submit' || action.startsWith('/doc-requests/')) {
        const rid = action==='/submit'?null:action.split('/')[2];
        const required=rid?row.pendingRequests.find(item=>item.requestId===rid).kinds:row.requiredDocs;
        const missing=required.filter(kind=>!row.documents.some(doc=>doc.kind===kind && doc.status!=='removed' && (!rid||doc.requestId===rid)));
        if (!rid && !row.applicant.addressHk) missing.unshift('address_hk');
        if (missing.length) return Response.json({code:422,des:'Missing required fields',result:{missing}},{status:422});
        if (rid) {row.pendingRequests=[];row.pendingRequestCount=0;}else{row.status='submitted';row.submittedAt=now;}
        return ok(row);
      }
    }
    throw new Error(`Unexpected fixture API: ${method} ${path}`);
  };
}
