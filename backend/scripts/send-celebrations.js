const fs=require('node:fs');
const path=require('node:path');
const currentYear=()=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric'}).format(new Date()));
const clean=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokens=(value,person)=>String(value).replace(/{{\s*name\s*}}/gi,person.display_name).replace(/{{\s*years\s*}}/gi,String(person.years||'')).replace(/{{\s*company\s*}}/gi,'Grupo ABR');
const defaults={birthday:{subject_template:'Feliz aniversário, {{name}}! 🎉',headline:'Hoje é dia de celebrar você!',message_html:'<p>Que este novo ciclo seja repleto de saúde, alegrias e grandes conquistas.</p><p>Receba o carinho de toda a equipe do <strong>Grupo ABR</strong>.</p>'},work_anniversary:{subject_template:'{{name}}, feliz aniversário de Grupo ABR!',headline:'Uma história construída com a gente',message_html:'<p>Hoje celebramos <strong>{{years}} ano(s)</strong> da sua trajetória no Grupo ABR.</p><p>Obrigado por fazer parte dessa construção e por contribuir todos os dias.</p>'}};

async function ensureImageColumns(pool){
  await pool.query(`ALTER TABLE public.celebration_email_templates
    ADD COLUMN IF NOT EXISTS image_base bytea,
    ADD COLUMN IF NOT EXISTS image_mime text,
    ADD COLUMN IF NOT EXISTS photo_x_pct numeric NOT NULL DEFAULT 72,
    ADD COLUMN IF NOT EXISTS photo_y_pct numeric NOT NULL DEFAULT 48,
    ADD COLUMN IF NOT EXISTS photo_size_pct numeric NOT NULL DEFAULT 24`);
}
async function personalizedCard(template,person,fallbackPath){
  const sharp = require('sharp');
  const source=sharp(template.image_base).rotate();
  const meta=await source.metadata();if(!meta.width||!meta.height)return null;
  const scale=Math.min(1,1200/meta.width),width=Math.max(1,Math.round(meta.width*scale)),height=Math.max(1,Math.round(meta.height*scale));
  const base=await source.resize({width,withoutEnlargement:true}).png().toBuffer();
  const size=Math.max(80,Math.round(width*Number(template.photo_size_pct||24)/100));
  const profileSource=person.photo_data||fs.readFileSync(fallbackPath);
  const mask=Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`);
  const profile=await sharp(profileSource).rotate().resize(size,size,{fit:'cover'}).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
  const borderSize=size+12,border=Buffer.from(`<svg width="${borderSize}" height="${borderSize}"><circle cx="${borderSize/2}" cy="${borderSize/2}" r="${size/2+4}" fill="white"/></svg>`);
  const centerX=width*Number(template.photo_x_pct||72)/100,centerY=height*Number(template.photo_y_pct||48)/100;
  const left=Math.max(0,Math.min(width-borderSize,Math.round(centerX-borderSize/2))),top=Math.max(0,Math.min(height-borderSize,Math.round(centerY-borderSize/2)));
  return sharp(base).composite([{input:border,left,top},{input:profile,left:left+6,top:top+6}]).jpeg({quality:90}).toBuffer();
}
function emailHtml(person,type,template,hasCard){const visual=hasCard?'<img src="cid:celebration-card" width="600" alt="Cartão comemorativo de '+clean(person.display_name)+'" style="display:block;width:100%;height:auto">':'<img src="cid:expertaco-logo" width="170" alt="Intranet #ParceirAÇO · Grupo ABR"><img src="cid:profile-photo" width="160" height="160" alt="Foto de '+clean(person.display_name)+'" style="display:block;width:160px;height:160px;object-fit:cover;border-radius:50%;margin:26px auto 18px;border:6px solid #eef1f8">';return `<!doctype html><html><body style="margin:0;background:#f3f5fa;font-family:Arial,sans-serif;color:#1b2440"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden"><tr><td style="height:8px;background:#f18800"></td></tr><tr><td align="center">${visual}</td></tr><tr><td align="center" style="padding:28px 34px 12px"><p style="margin:0;color:#f18800;font-size:12px;font-weight:bold;letter-spacing:1.5px">${type==='birthday'?'ANIVERSÁRIO':'ANIVERSÁRIO DE EMPRESA'}</p><h1 style="margin:10px 0 6px;color:#253575;font-size:30px">${clean(tokens(template.headline,person))}</h1><h2 style="margin:0 0 22px;color:#253575;font-size:22px">${clean(person.display_name)}</h2><div style="font-size:16px;line-height:1.7;color:#4f5873">${tokens(template.message_html,person)}</div></td></tr><tr><td align="center" style="padding:20px 34px 32px;color:#7a8298;font-size:12px">Uma mensagem do Grupo ABR · #ParceirAÇO</td></tr></table></td></tr></table></body></html>`;}

function smtpOptions(){
  const host=process.env.IDEAACO_SMTP_HOST||'smtp.gmail.com';
  const port=Number(process.env.IDEAACO_SMTP_PORT||587);
  const secure=process.env.IDEAACO_SMTP_SECURE ? process.env.IDEAACO_SMTP_SECURE !== 'false' : port===465;
  const options=[
    {host:'smtp.gmail.com',port:587,secure:false,requireTLS:true,family:4},
    {host,port,secure,requireTLS:!secure&&port===587,family:4},
    {host:'smtp.gmail.com',port:465,secure:true,family:4}
  ];
  return options.filter((item,index,self)=>index===self.findIndex(other=>other.host===item.host&&other.port===item.port&&other.secure===item.secure));
}
function shouldRetrySmtp(error){
  const code=String(error.code||'');
  const message=String(error.message||'').toLowerCase();
  return ['ETIMEDOUT','ESOCKET','ECONNECTION','ECONNRESET','EHOSTUNREACH','ENETUNREACH'].includes(code)||message.includes('timeout')||message.includes('timed out');
}
function parseAddress(value){
  const raw=String(value||'').trim(),match=raw.match(/^(.*)<([^>]+)>$/);
  return match?{name:match[1].trim().replace(/^"|"$/g,''),email:match[2].trim()}:{email:raw};
}
function parseRecipients(value){return String(value||'').split(',').map(item=>item.trim()).filter(Boolean).map(email=>({email}));}
function attachmentContent(attachment){
  const content=attachment.content||fs.readFileSync(attachment.path);
  return Buffer.isBuffer(content)?content.toString('base64'):Buffer.from(String(content)).toString('base64');
}
async function sendBrevo(message,context={}){
  const apiKey=process.env.BREVO_API_KEY;
  if(!apiKey)throw new Error('BREVO_API_KEY não configurada.');
  const from=parseAddress(process.env.CELEBRATION_EMAIL_FROM||message.from);
  const payload={
    sender:from,
    to:parseRecipients(message.to),
    subject:message.subject,
    htmlContent:message.html,
    attachment:(message.attachments||[]).map(attachment=>({
      name:attachment.filename,
      content:attachmentContent(attachment),
      contentId:attachment.cid||undefined
    }))
  };
  const cc=parseRecipients(message.cc);if(cc.length)payload.cc=cc;
  console.log(JSON.stringify({event:'brevo-send',stage:'sending',...context}));
  const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':apiKey,'accept':'application/json','Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok){const body=await response.text().catch(()=>'');console.error(JSON.stringify({event:'brevo-send',stage:'failed',status:response.status,body:body.slice(0,500),...context}));throw new Error('Brevo respondeu '+response.status);}
  const result=await response.json().catch(()=>({}));
  console.log(JSON.stringify({event:'brevo-send',stage:'sent',status:response.status,messageId:result.messageId||'',...context}));
  return {provider:'brevo',status:response.status,messageId:result.messageId||''};
}
async function sendEmail(nodemailer,auth,message,context={}){
  if(process.env.BREVO_API_KEY||String(process.env.CELEBRATION_EMAIL_PROVIDER||'').toLowerCase()==='brevo')return sendBrevo(message,context);
  return sendGmail(nodemailer,auth,message,context);
}
async function sendGmail(nodemailer,auth,message,context={}){
  const options=smtpOptions();
  let lastError;
  for(let attempt=0;attempt<options.length;attempt++){
    const transport=nodemailer.createTransport({
      ...options[attempt],
      auth,
      connectionTimeout:15000,
      greetingTimeout:10000,
      socketTimeout:15000,
      tls:{servername:options[attempt].host}
    });
    try{
      console.log(JSON.stringify({event:'gmail-send',stage:'connecting',attempt:attempt+1,host:options[attempt].host,port:options[attempt].port,secure:options[attempt].secure,requireTLS:Boolean(options[attempt].requireTLS),...context}));
      const result=await transport.sendMail(message);
      console.log(JSON.stringify({event:'gmail-send',stage:'sent',attempt:attempt+1,host:options[attempt].host,port:options[attempt].port,secure:options[attempt].secure,requireTLS:Boolean(options[attempt].requireTLS),...context}));
      return result;
    }catch(error){
      lastError=error;
      console.error(JSON.stringify({event:'gmail-send',stage:'failed',attempt:attempt+1,host:options[attempt].host,port:options[attempt].port,secure:options[attempt].secure,requireTLS:Boolean(options[attempt].requireTLS),code:error.code||'',message:error.message,...context}));
      if(!shouldRetrySmtp(error)||attempt===options.length-1)throw error;
    }finally{
      transport.close();
    }
  }
  throw lastError;
}
async function sendCelebrationTest({recipient,userId,type='birthday'}){
 const {Pool}=require('pg'),nodemailer=require('nodemailer');
 const user=process.env.IDEAACO_EMAIL_USER,pass=String(process.env.IDEAACO_EMAIL_APP_PASSWORD||'').replace(/\s+/g,'');if(!process.env.DATABASE_URL||!user||!pass)throw new Error('Configuração de e-mail indisponível.');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:2});
 try{
  await ensureImageColumns(pool);const year=currentYear(),logo=path.resolve(__dirname,'..','..','frontend','assets','expertaço.png');
  const person=(await pool.query(`SELECT user_id,email,display_name,photo_data,photo_mime,CASE WHEN hire_date IS NULL THEN 0 ELSE EXTRACT(YEAR FROM age((now() AT TIME ZONE 'America/Sao_Paulo')::date,hire_date))::int END years FROM public.user_profiles WHERE user_id=$1 AND active=true`,[userId])).rows[0];
  if(!person)throw new Error('Perfil de teste não encontrado.');
  const template=(await pool.query('SELECT event_type,subject_template,headline,message_html,image_base,image_mime,photo_x_pct,photo_y_pct,photo_size_pct FROM public.celebration_email_templates WHERE event_type=$1 AND template_year=$2 AND active=true',[type,year])).rows[0];
  if(!template?.image_base)throw new Error('Salve uma imagem-base ativa antes do teste.');
  const card=await personalizedCard(template,person,logo);if(!card)throw new Error('Não foi possível gerar o cartão.');
  await sendEmail(nodemailer,{user,pass},{from:`Intranet #ParceirAÇO · Grupo ABR <${user}>`,to:recipient,subject:'[TESTE] '+tokens(template.subject_template,person),html:emailHtml(person,type,template,true),attachments:[{filename:'cartao-personalizado.jpg',content:card,contentType:'image/jpeg',cid:'celebration-card'}]},{type,recipient,mode:'test'});
  return {sent:true,recipient,type};
 }finally{await pool.end();}
}
async function sendCelebrations(){
 const {Pool}=require('pg'),nodemailer=require('nodemailer');
 const user=process.env.IDEAACO_EMAIL_USER,pass=String(process.env.IDEAACO_EMAIL_APP_PASSWORD||'').replace(/\s+/g,'');if(!process.env.DATABASE_URL||!user||!pass)throw new Error('DATABASE_URL e credenciais de e-mail são obrigatórias.');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:2});
 try{
  await ensureImageColumns(pool);
  const year=currentYear(),logo=path.resolve(__dirname,'..','..','frontend','assets','expertaço.png');
  const people=(await pool.query(`SELECT user_id,email,display_name,photo_data,photo_mime,birth_date,hire_date,(birth_date IS NOT NULL AND to_char(birth_date,'MM-DD')=to_char(now() AT TIME ZONE 'America/Sao_Paulo','MM-DD')) is_birthday,(hire_date IS NOT NULL AND hire_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date AND to_char(hire_date,'MM-DD')=to_char(now() AT TIME ZONE 'America/Sao_Paulo','MM-DD')) is_work_anniversary,CASE WHEN hire_date IS NULL THEN 0 ELSE EXTRACT(YEAR FROM age((now() AT TIME ZONE 'America/Sao_Paulo')::date,hire_date))::int END years FROM public.user_profiles WHERE active=true AND email LIKE '%@grupoabr.com.br' AND ((birth_date IS NOT NULL AND to_char(birth_date,'MM-DD')=to_char(now() AT TIME ZONE 'America/Sao_Paulo','MM-DD')) OR (hire_date IS NOT NULL AND hire_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date AND to_char(hire_date,'MM-DD')=to_char(now() AT TIME ZONE 'America/Sao_Paulo','MM-DD')))`)).rows;
  const templates=(await pool.query('SELECT event_type,subject_template,headline,message_html,image_base,image_mime,photo_x_pct,photo_y_pct,photo_size_pct FROM public.celebration_email_templates WHERE template_year=$1 AND active=true',[year])).rows.reduce((all,item)=>(all[item.event_type]=item,all),{});let sent=0;
  for(const person of people)for(const type of ['birthday','work_anniversary']){
    if(type==='birthday'&&!person.is_birthday)continue;if(type==='work_anniversary'&&(!person.is_work_anniversary||person.years<1))continue;
    if((await pool.query('SELECT 1 FROM public.celebration_email_log WHERE user_id=$1 AND event_type=$2 AND celebration_year=$3',[person.user_id,type,year])).rowCount)continue;
    const template=templates[type]||defaults[type],card=await personalizedCard(template,person,logo),attachments=[{filename:'expertaco.png',path:logo,cid:'expertaco-logo'}];
    if(card)attachments.push({filename:'cartao-personalizado.jpg',content:card,contentType:'image/jpeg',cid:'celebration-card'});
    else attachments.push(person.photo_data?{filename:'perfil.jpg',content:person.photo_data,contentType:person.photo_mime,cid:'profile-photo'}:{filename:'expertaco-perfil.png',path:logo,cid:'profile-photo'});
    await sendEmail(nodemailer,{user,pass},{from:`Intranet #ParceirAÇO · Grupo ABR <${user}>`,to:person.email,cc:process.env.CELEBRATION_EMAIL_CC||undefined,subject:tokens(template.subject_template,person),html:emailHtml(person,type,template,Boolean(card)),attachments},{type,recipient:person.email,mode:'automatic'});
    await pool.query('INSERT INTO public.celebration_email_log(user_id,event_type,celebration_year,recipient_email) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[person.user_id,type,year,person.email]);sent++;
  }
  console.log(JSON.stringify({status:'ok',year,people:people.length,sent}));return{year,people:people.length,sent};
 }finally{await pool.end();}
}
if(require.main===module)sendCelebrations().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={sendCelebrations,sendCelebrationTest,personalizedCard};


