const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const createAdminApi = require('./admin-server');
const { sendCelebrations, sendCelebrationTest } = require('./scripts/send-celebrations');
const { rankingFromCsv } = require('./csv-ranking-sheets');
const { rankingFromSpreadsheetCsv } = require('./ranking-spreadsheet');
const { rankingFromXlsx } = require('./ranking-import');

const root = __dirname;
const projectRoot = path.resolve(root, '..');
const publicDir = fs.existsSync(path.join(root, 'dist')) ? path.join(root, 'dist') : path.join(projectRoot, 'frontend', 'public');
const rankingFile = path.join(root, 'data', 'ranking.json');
const port = Number(process.env.PORT || 3000);
const mode = ['mock', 'manual', 'api'].includes(process.env.SALES_DATA_MODE) ? process.env.SALES_DATA_MODE : 'mock';
const rankingSpreadsheetId = '10XOSE1z8HucS0_5K_8iX8VFg6s0ASZJwDAMfo0uacIA';
const defaultSellerRankingUrl = `https://docs.google.com/spreadsheets/d/${rankingSpreadsheetId}/gviz/tq?tqx=out:csv&sheet=2_Ranking%20por%20Vendedor&range=A5:K1000`;
const defaultTeamRankingUrl = `https://docs.google.com/spreadsheets/d/${rankingSpreadsheetId}/gviz/tq?tqx=out:csv&sheet=3_Ranking%20por%20Regi%C3%A3o&range=A5:H1000`;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.gif': 'image/gif' };

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': typeof payload === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readRanking() {
  return JSON.parse(fs.readFileSync(rankingFile, 'utf8'));
}

function validRanking(input) {
  const teams = input?.teams || input?.regions;
  return input && typeof input.period === 'string' && Array.isArray(teams) && Array.isArray(input.sellers) && [...teams, ...input.sellers].every(item => item && typeof item.name === 'string');
}

async function getRanking() {
  if (mode !== 'api') return { ...readRanking(), source: mode };
  const sellerUrl = process.env.SALES_DATA_URL?.includes(rankingSpreadsheetId) ? process.env.SALES_DATA_URL : defaultSellerRankingUrl;
  const teamUrl = process.env.SALES_TEAM_DATA_URL || defaultTeamRankingUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const responses = await Promise.all([sellerUrl, teamUrl].map(url => fetch(url, { signal: controller.signal })));
    if (responses.some(response => !response.ok)) throw new Error('Fonte externa respondeu com erro');
    const [sellerRaw, teamRaw] = await Promise.all(responses.map(response => response.text()));
    const data = rankingFromSpreadsheetCsv(sellerRaw, teamRaw);
    if (!validRanking(data)) throw new Error('Contrato de ranking inválido');
    return { ...data, source: 'api' };
  } finally { clearTimeout(timer); }
}

function parseRankingUpload(filename, buffer) {
  if (/\.csv$/i.test(filename)) return rankingFromCsv(buffer.toString('utf8'));
  if (/\.xlsx$/i.test(filename) || /\.xls$/i.test(filename)) return rankingFromXlsx(buffer);
  throw new Error('Formato inválido. Envie .xlsx, .xls ou .csv.');
}

function parseBase64Upload(input) {
  const match = String(input || '').match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Arquivo inválido.');
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function authorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseBody(req, maxBytes = 250000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > maxBytes) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}

const ideaRecipients = {
  to: 'grupoabr19@gmail.com',
  cc: ['thiago.almeida@grupoabr.com.br', 'marcelo.silva@grupoabr.com.br', 'anderson.silva@grupoabr.com.br', 'pietra.leite@grupoabr.com.br']
};
const ideaRateLimit = new Map();
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);

function ideaMailTransport() {
  const user = process.env.IDEAACO_EMAIL_USER;
  const pass = process.env.IDEAACO_EMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({ service:'gmail', auth:{ user, pass } });
}

function ideaRequestAllowed(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (ideaRateLimit.get(ip) || []).filter(timestamp => now - timestamp < 10 * 60 * 1000);
  if (recent.length >= 3) return false;
  recent.push(now); ideaRateLimit.set(ip, recent); return true;
}

async function sendIdeaMessage(input) {
  const transport = ideaMailTransport();
  if (!transport) throw new Error('IDEAACO_EMAIL_NOT_CONFIGURED');
  const name=cleanText(input.name,120),email=cleanText(input.email,180),category=cleanText(input.category,80),title=cleanText(input.title,180),message=cleanText(input.message,5000);
  if (!name || !category || !title || !message) throw new Error('IDEAACO_INVALID');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('IDEAACO_INVALID');
  const subject=`[#IdeAÇO] ${category}: ${title}`;
  const html=`<h2>Nova contribuição para o #IdeAÇO</h2><p><b>Nome:</b> ${escapeHtml(name)}</p><p><b>E-mail:</b> ${escapeHtml(email||'Não informado')}</p><p><b>Categoria:</b> ${escapeHtml(category)}</p><p><b>Título:</b> ${escapeHtml(title)}</p><p><b>Mensagem:</b></p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
  await transport.sendMail({ from:`Intranet #ParceirAÇO — #IdeAÇO <${process.env.IDEAACO_EMAIL_USER}>`, to:ideaRecipients.to, cc:ideaRecipients.cc, replyTo:email||undefined, subject, text:`Nova contribuição para o #IdeAÇO\n\nNome: ${name}\nE-mail: ${email||'Não informado'}\nCategoria: ${category}\nTítulo: ${title}\n\n${message}`, html });
}
const neonAuthBaseUrl = process.env.NEON_AUTH_BASE_URL || '';
const corporateEmail = email => typeof email === 'string' && /^[^\s@]+@grupoabr\.com\.br$/i.test(email.trim());
const allowedAuthRoutes = new Set(['sign-up/email','sign-in/email','sign-out','get-session']);

async function proxyNeonAuth(req, res, route) {
  if (!neonAuthBaseUrl) return send(res, 503, { error:'Autenticação ainda não configurada.' });
  if (!allowedAuthRoutes.has(route)) return send(res, 404, { error:'Rota de autenticação não encontrada.' });
  try {
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await parseBody(req);
      if ((route === 'sign-up/email' || route === 'sign-in/email') && !corporateEmail(body.email)) return send(res, 403, { error:'Use exclusivamente seu e-mail @grupoabr.com.br.' });
    }
    const response = await fetch(`${neonAuthBaseUrl.replace(/\/$/,'')}/${route}`, {
      method:req.method,
      headers:{'Content-Type':'application/json','Accept':'application/json','Cookie':req.headers.cookie||'','Origin':process.env.APP_ORIGIN||'https://experta-o.onrender.com'},
      body:body?JSON.stringify(body):undefined,
      redirect:'manual'
    });
    const payload = await response.text();
    let parsed=null; try { parsed=JSON.parse(payload); } catch {}
    const sessionEmail=parsed?.user?.email||parsed?.session?.user?.email||parsed?.data?.user?.email;
    if (route === 'get-session' && sessionEmail && !corporateEmail(sessionEmail)) return send(res, 403, { error:'Conta fora do domínio corporativo.' });
    const headers={};
    const cookies=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[];
    if(cookies.length)headers['Set-Cookie']=cookies;
    res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')||'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(payload);
  } catch (error) {
    console.error('Falha Neon Auth:',error.message);
    return send(res,502,{error:'Não foi possível acessar a autenticação agora.'});
  }
}
let databasePool;
function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  if (!databasePool) { const { Pool } = require('pg'); databasePool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:5}); }
  return databasePool;
}
async function authenticatedUser(req) {
  if (!neonAuthBaseUrl || !req.headers.cookie) return null;
  const response=await fetch(`${neonAuthBaseUrl.replace(/\/$/,'')}/get-session`,{headers:{Cookie:req.headers.cookie,Accept:'application/json',Origin:process.env.APP_ORIGIN||'https://experta-o.onrender.com'}});
  if(!response.ok)return null;
  const data=await response.json().catch(()=>null);const session=data?.user?data:data?.data?.user?data.data:data?.session?.user?data.session:null;const user=session?.user;
  return user&&corporateEmail(user.email)?{id:String(user.id),email:String(user.email).toLowerCase(),name:cleanText(user.name||user.email.split('@')[0],120)}:null;
}
const safeUrl=value=>{const url=cleanText(value,500);if(!url)return'';try{const parsed=new URL(url);return ['http:','https:'].includes(parsed.protocol)?parsed.toString():'';}catch{return'';}};
const safeImageUrl=value=>{const url=safeUrl(value);if(!url)return'';try{return /\.(?:png|jpe?g|gif|webp)$/i.test(new URL(url).pathname)?url:'';}catch{return'';}};
let profileColumnsReady=false;
async function ensureProfileColumns(){if(profileColumnsReady)return;await db().query(`ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS signature_url text NOT NULL DEFAULT ''`);profileColumnsReady=true;}
async function ensureProfile(user){
  await ensureProfileColumns();
  const existingByUserId = await db().query('SELECT * FROM public.user_profiles WHERE user_id=$1', [user.id]);
  if (existingByUserId.rowCount) {
    const result = await db().query('UPDATE public.user_profiles SET email=$2,updated_at=now() WHERE user_id=$1 RETURNING *', [user.id, user.email]);
    return result.rows[0];
  }
  const existingByEmail = await db().query('SELECT * FROM public.user_profiles WHERE lower(email)=lower($1) ORDER BY created_at ASC LIMIT 1', [user.email]);
  if (existingByEmail.rowCount) {
    const result = await db().query("UPDATE public.user_profiles SET user_id=$1,email=$2,display_name=COALESCE(NULLIF(display_name,''),$3),updated_at=now() WHERE user_id=$4 RETURNING *", [user.id, user.email, user.name, existingByEmail.rows[0].user_id]);
    return result.rows[0];
  }
  const result=await db().query(`INSERT INTO public.user_profiles(user_id,email,display_name) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email RETURNING *`,[user.id,user.email,user.name]);return result.rows[0];
}
function publicProfile(row){const {photo_data,photo_mime,...profile}=row;return {...profile,has_photo:Boolean(photo_data),photo_url:photo_data?`/api/profile/photo?id=${encodeURIComponent(row.user_id)}`:''};}
function jpegDimensions(buffer){let offset=2;while(offset<buffer.length){if(buffer[offset]!==0xff){offset++;continue;}const marker=buffer[offset+1];const length=buffer.readUInt16BE(offset+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:buffer.readUInt16BE(offset+5),width:buffer.readUInt16BE(offset+7)};offset+=2+length;}return null;}
function decodeProfilePhoto(value){if(!value)return null;const match=String(value).match(/^data:(image\/jpeg);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw new Error('PHOTO_INVALID');const buffer=Buffer.from(match[2],'base64');if(!buffer.length||buffer.length>650000)throw new Error('PHOTO_INVALID');const size=jpegDimensions(buffer);if(!size||size.width!==400||size.height!==400)throw new Error('PHOTO_DIMENSIONS');return{buffer,mime:match[1]};}
async function handleProfile(req,res){
  const user=await authenticatedUser(req);if(!user)return send(res,401,{error:'Faça login para acessar seu perfil.'});
  await ensureProfileColumns();
  if(req.method==='GET')return send(res,200,publicProfile(await ensureProfile(user)));
  if(req.method==='PUT'){
    const input=await parseBody(req,1200000),name=cleanText(input.displayName,120),bio=cleanText(input.bio,301),mood=cleanText(input.mood,81),birthDate=cleanText(input.birthDate,10),hireDate=cleanText(input.hireDate,10);
    if(!name||bio.length>300||mood.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)||!/^\d{4}-\d{2}-\d{2}$/.test(hireDate))return send(res,400,{error:'Nome, aniversário e data de entrada são obrigatórios. Confira também os limites do perfil.'});
    if(new Date(birthDate+'T12:00:00Z')>new Date()||new Date(hireDate+'T12:00:00Z')>new Date())return send(res,400,{error:'As datas do perfil não podem estar no futuro.'});
    let photo=null;try{photo=decodeProfilePhoto(input.photoData);}catch(error){return send(res,400,{error:error.message==='PHOTO_DIMENSIONS'?'A foto precisa ter exatamente 400 × 400 pixels.':'Envie uma foto JPG válida de até 650 KB.'});}
    await ensureProfile(user);
    const values=[user.id,name,bio,safeUrl(input.linkedinUrl),safeUrl(input.instagramUrl),safeUrl(input.facebookUrl),mood,birthDate,hireDate,safeImageUrl(input.signatureUrl)];
    let query=`UPDATE public.user_profiles SET display_name=$2,bio=$3,linkedin_url=$4,instagram_url=$5,facebook_url=$6,mood=$7,birth_date=$8,hire_date=$9,signature_url=$10,updated_at=now()`;
    if(photo){values.push(photo.buffer,photo.mime);query+=`,photo_data=$11,photo_mime=$12`;}
    query+=` WHERE user_id=$1 RETURNING *`;const result=await db().query(query,values);return send(res,200,publicProfile(result.rows[0]));
  }
  return send(res,405,{error:'Método não permitido.'});
}
async function handleProfilePhoto(req,res,url){const viewer=await authenticatedUser(req);if(!viewer)return send(res,401,{error:'Faça login.'});const userId=cleanText(url.searchParams.get('id'),180);const result=await db().query('SELECT photo_data,photo_mime FROM public.user_profiles WHERE user_id=$1 AND active=true',[userId]);const photo=result.rows[0];if(!photo?.photo_data)return send(res,404,{error:'Foto não encontrada.'});res.writeHead(200,{'Content-Type':photo.photo_mime,'Cache-Control':'private, max-age=3600','Content-Length':photo.photo_data.length});res.end(photo.photo_data);}
async function handleProfiles(req,res,url){
  const viewer=await authenticatedUser(req);if(!viewer)return send(res,401,{error:'Faça login para consultar perfis.'});
  await ensureProfileColumns();
  const query=cleanText(url.searchParams.get('q'),80);
  const userId=cleanText(url.searchParams.get('id'),180);
  const params=[];let where='p.active=true';
  if(userId){params.push(userId);where+=' AND p.user_id=$'+params.length;}
  else if(query){params.push('%'+query.toLowerCase()+'%');where+=` AND (lower(p.display_name) LIKE $${params.length} OR lower(p.email) LIKE $${params.length} OR lower(COALESCE(p.bio,'')) LIKE $${params.length} OR lower(COALESCE(p.mood,'')) LIKE $${params.length} OR lower(COALESCE(a.name,'')) LIKE $${params.length})`;}
  const limit=userId?1:18;
  params.push(limit);
  const result=await db().query(`SELECT p.user_id,p.email,p.display_name,p.bio,p.mood,p.linkedin_url,p.instagram_url,p.facebook_url,p.signature_url,p.photo_data IS NOT NULL AS has_photo,a.name area_name FROM public.user_profiles p LEFT JOIN public.portal_areas a ON a.id=p.area_id WHERE ${where} ORDER BY p.display_name LIMIT $${params.length}`,params);
  return send(res,200,{profiles:result.rows.map(publicProfile)});
}
let feedColumnsReady=false;
async function ensureFeedColumns(){if(feedColumnsReady)return;await db().query(`ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'general', ADD COLUMN IF NOT EXISTS area_id uuid`);feedColumnsReady=true;}
const feedProfileSelect='u.display_name,u.bio,u.linkedin_url,u.instagram_url,u.facebook_url,u.signature_url,u.photo_data IS NOT NULL AS has_photo';
async function handleFeed(req,res,url){const user=await authenticatedUser(req);if(!user)return send(res,401,{error:'Faça login para acessar o feed.'});const profile=await ensureProfile(user);await ensureFeedColumns();if(req.method==='GET'){const scope=cleanText(url.searchParams.get('scope'),20)==='team'?'team':'general';const params=[];let where="p.hidden_at IS NULL AND COALESCE(p.visibility,'general')='general'";if(scope==='team'){where="p.hidden_at IS NULL AND p.visibility='team' AND p.area_id=$1";params.push(profile.area_id||null);}const result=await db().query(`SELECT p.id,p.content,p.created_at,p.user_id,p.visibility,a.name area_name,${feedProfileSelect} FROM public.feed_posts p JOIN public.user_profiles u ON u.user_id=p.user_id LEFT JOIN public.portal_areas a ON a.id=p.area_id WHERE ${where} ORDER BY p.created_at DESC LIMIT 80`,params);return send(res,200,{scope,areaId:profile.area_id||null,posts:result.rows});}if(req.method==='POST'){const input=await parseBody(req),content=cleanText(input.content,501),visibility=cleanText(input.visibility,20)==='team'?'team':'general';if(!content||content.length>500)return send(res,400,{error:'A publicação deve ter entre 1 e 500 caracteres.'});if(visibility==='team'&&!profile.area_id)return send(res,400,{error:'Defina uma área para seu perfil antes de publicar para a equipe.'});const result=await db().query(`INSERT INTO public.feed_posts(user_id,content,visibility,area_id) VALUES($1,$2,$3,$4) RETURNING id,content,created_at,user_id,visibility,area_id`,[user.id,content,visibility,visibility==='team'?profile.area_id:null]);return send(res,201,result.rows[0]);}return send(res,405,{error:'Método não permitido.'});}
const adminApi = createAdminApi({ db, authenticatedUser, ensureProfile, send, parseBody, cleanText, safeUrl });

function serveFile(req, res) {
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (requested === '/expertaço.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
    return fs.createReadStream(path.join(projectRoot, 'frontend', 'assets', 'expertaço.png')).pipe(res);
  }
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const candidate = path.resolve(publicDir, relative);
  if (!candidate.startsWith(path.resolve(publicDir)) || !fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
    const index = path.join(publicDir, 'index.html');
    res.writeHead(200, { 'Content-Type': mime['.html'] }); return fs.createReadStream(index).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(candidate)] || 'application/octet-stream', 'Cache-Control': /\.(?:html|js|css)$/.test(candidate) ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(candidate).pipe(res);
}

let celebrationCheckAt=0,celebrationCheckRunning=false;
async function maybeSendCelebrations(){const now=Date.now();if(celebrationCheckRunning||now-celebrationCheckAt<60*60*1000||!process.env.DATABASE_URL||!process.env.IDEAACO_EMAIL_USER||!process.env.IDEAACO_EMAIL_APP_PASSWORD)return;celebrationCheckAt=now;celebrationCheckRunning=true;try{await sendCelebrations();}catch(error){console.error('Falha na verificação de celebrações:',error.message);}finally{celebrationCheckRunning=false;}}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') { maybeSendCelebrations(); return send(res, 200, { status: 'ok', mode, timestamp: new Date().toISOString() }); }
  if (url.pathname === '/api/access/me' && req.method === 'GET') { try{return await adminApi.me(req,res);}catch(error){console.error('Falha no acesso:',error.message);return send(res,502,{error:'Não foi possível consultar as permissões.'});} }
  if (url.pathname === '/api/admin/areas') { try{return await adminApi.areas(req,res);}catch(error){console.error('Falha nas áreas:',error.message);return send(res,502,{error:'Não foi possível gerenciar as áreas.'});} }
  if (url.pathname === '/api/admin/users') { try{return await adminApi.users(req,res);}catch(error){console.error('Falha nos perfis:',error.message);return send(res,502,{error:'Não foi possível gerenciar os perfis.'});} }
  if (url.pathname === '/api/admin/feed') { try{return await adminApi.moderateFeed(req,res);}catch(error){console.error('Falha na moderação:',error.message);return send(res,502,{error:'Não foi possível moderar o feed.'});} }
  if (url.pathname === '/api/celebration-test' && req.method === 'POST') {
    try {
      const ctx=await adminApi.authorize(req,res,'celebration_templates','manage');if(!ctx)return;
      const input=await parseBody(req),recipient=cleanText(input.recipient,180).toLowerCase(),type=cleanText(input.type,24);
      if(!['birthday','work_anniversary'].includes(type))return send(res,400,{error:'Modelo de teste inválido.'});
      if(!(recipient.endsWith('@grupoabr.com.br')||recipient==='grupoabr19@gmail.com'))return send(res,400,{error:'Use um e-mail @grupoabr.com.br ou o endereço de teste autorizado.'});
      return send(res,200,await sendCelebrationTest({recipient,userId:ctx.user.id,type}));
    } catch(error){console.error('Falha no teste comemorativo:',error.message);return send(res,502,{error:error.message||'Não foi possível enviar o teste.'});}
  }  if (url.pathname === '/api/celebration-template-image' && req.method === 'GET') { try{return await adminApi.celebrationTemplateImage(req,res);}catch(error){console.error('Falha na imagem do template:',error.message);return send(res,502,{error:'Não foi possível carregar a imagem do template.'});} }
  if (url.pathname === '/api/celebration-templates') { try{return await adminApi.celebrationTemplates(req,res);}catch(error){console.error('Falha nos templates:',error.message);return send(res,502,{error:'Não foi possível acessar os templates.'});} }
  if (url.pathname === '/api/announcements') { try{return await adminApi.announcements(req,res,url);}catch(error){console.error('Falha nos comunicados:',error.message);return send(res,502,{error:'Não foi possível acessar os comunicados.'});} }  if (url.pathname === '/api/profile/photo' && req.method === 'GET') { try{return await handleProfilePhoto(req,res,url);}catch(error){console.error('Falha na foto:',error.message);return send(res,502,{error:'Não foi possível carregar a foto.'});} }
  if (url.pathname === '/api/profile') { try{return await handleProfile(req,res);}catch(error){console.error('Falha no perfil:',error.message);return send(res,502,{error:'Não foi possível acessar o perfil agora.'});} }
  if (url.pathname === '/api/profiles' && req.method === 'GET') { try{return await handleProfiles(req,res,url);}catch(error){console.error('Falha na consulta de perfis:',error.message);return send(res,502,{error:'Não foi possível consultar perfis agora.'});} }
  if (url.pathname === '/api/feed') { try{return await handleFeed(req,res,url);}catch(error){console.error('Falha no feed:',error.message);return send(res,502,{error:'Não foi possível acessar o feed agora.'});} }  if (url.pathname.startsWith('/api/auth/')) {
    const authRoute=url.pathname.slice('/api/auth/'.length);
    if (!['GET','POST'].includes(req.method)) return send(res,405,{error:'Método não permitido.'});
    return proxyNeonAuth(req,res,authRoute);
  }  if (url.pathname === '/api/ideaaco' && req.method === 'POST') {
    if (!ideaRequestAllowed(req)) return send(res, 429, { error:'Muitas mensagens em pouco tempo. Aguarde alguns minutos.' });
    try {
      const body = await parseBody(req);
      if (body.website) return send(res, 202, { sent:true });
      await sendIdeaMessage(body);
      return send(res, 202, { sent:true });
    } catch (error) {
      if (error.message === 'IDEAACO_INVALID') return send(res, 400, { error:'Confira os campos obrigatórios e tente novamente.' });
      if (error.message === 'IDEAACO_EMAIL_NOT_CONFIGURED') return send(res, 503, { error:'O canal de e-mail ainda não foi ativado.' });
      console.error('Falha no envio #IdeAÇO:', error.message);
      return send(res, 502, { error:'Não foi possível enviar agora. Tente novamente em instantes.' });
    }
  }  if (url.pathname === '/api/ranking' && req.method === 'GET') {
    try { if(!await adminApi.authorize(req,res,'ranking','view'))return;return send(res, 200, await getRanking()); }
    catch (error) { return send(res, 502, { error: 'Não foi possível atualizar o ranking.', fallbackAvailable: true }); }
  }
  if (url.pathname === '/api/ranking/manual' && req.method === 'POST') {
    if (!authorized(req)) return send(res, 401, { error: 'Não autorizado.' });
    if (mode !== 'manual') return send(res, 409, { error: 'O modo manual não está ativo.' });
    try {
      const body = await parseBody(req);
      if (!validRanking(body)) return send(res, 400, { error: 'Dados de ranking inválidos.' });
      const saved = { ...body, updatedAt: new Date().toISOString() };
      fs.writeFileSync(rankingFile, JSON.stringify(saved, null, 2));
      return send(res, 200, { ...saved, source: 'manual' });
    } catch { return send(res, 400, { error: 'Não foi possível processar os dados.' }); }
  }
  if (url.pathname === '/api/ranking/import' && req.method === 'POST') {
    try {
      const ctx = await adminApi.authorize(req, res, 'ranking', 'manage');
      if (!ctx) return;
      const body = await parseBody(req, 20000000);
      const filename = cleanText(body.filename, 180);
      const upload = parseBase64Upload(body.fileData);
      const data = parseRankingUpload(filename, upload.buffer);
      if (!validRanking(data)) return send(res, 400, { error: 'Não foi possível identificar o contrato do ranking.' });
      const saved = { ...data, source: 'manual', importedFrom: filename, updatedAt: new Date().toISOString() };
      fs.writeFileSync(rankingFile, JSON.stringify(saved, null, 2));
      return send(res, 200, { ...saved, source: 'manual' });
    } catch (error) {
      return send(res, 400, { error: error.message || 'Não foi possível importar a planilha.' });
    }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Endpoint não encontrado.' });
  serveFile(req, res);
});

if (require.main === module) server.listen(port, '0.0.0.0', () => { console.log(`Intranet #ParceirAÇO disponível na porta ${port}`); setTimeout(maybeSendCelebrations,15000); setInterval(maybeSendCelebrations,6*60*60*1000).unref(); });module.exports = { server, validRanking };

