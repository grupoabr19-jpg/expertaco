const PRIMARY_ADMIN_EMAIL = 'thiago.almeida@grupoabr.com.br';
const ROLE_RANK = { member: 0, area_manager: 1, staff: 2, super_admin: 3 };
const RESOURCES = ['commercial_content','ranking','scripts','sales_routes','hero_announcements','celebration_templates'];
const LEVELS = { none: 0, view: 1, manage: 2 };
const FULL_ACCESS_AREA_SLUGS = new Set(['direcao','diretoria','coordenacao','supervisao','ti','gestao']);
const SALES_AREA_SLUGS = new Set(['comercial','vendas']);
function effectivePermissions(raw, areaSlug = '') {
  const permissions = Object.fromEntries(RESOURCES.map(resource => [resource, 'none']));
  const visibleResources = FULL_ACCESS_AREA_SLUGS.has(areaSlug)
    ? ['commercial_content','ranking','scripts','sales_routes']
    : SALES_AREA_SLUGS.has(areaSlug) ? ['commercial_content','ranking','scripts'] : [];
  visibleResources.forEach(resource => { permissions[resource] = 'view'; });
  for (const resource of ['hero_announcements','celebration_templates']) {
    if (raw[resource] === 'manage') permissions[resource] = 'manage';
  }
  if (areaSlug === 'rh' && raw.hero_announcements === 'manage' && !raw.celebration_templates) permissions.celebration_templates = 'manage';
  return permissions;
}
module.exports = function createAdminApi({ db, authenticatedUser, ensureProfile, send, parseBody, cleanText, safeUrl }) {
  async function context(req) {
    const user = await authenticatedUser(req);
    if (!user) return null;
    let profile = await ensureProfile(user);
    if (user.email === PRIMARY_ADMIN_EMAIL && profile.role !== 'super_admin') {
      profile = (await db().query("UPDATE public.user_profiles SET role='super_admin',active=true,updated_at=now() WHERE user_id=$1 RETURNING *", [user.id])).rows[0];
    }
    const permissions = {};
    if (profile.area_id) {
      const result = await db().query('SELECT resource,access_level FROM public.area_permissions WHERE area_id=$1', [profile.area_id]);
      result.rows.forEach(item => { permissions[item.resource] = item.access_level; });
    }
    const areaSlug = profile.area_id ? (await db().query('SELECT slug FROM public.portal_areas WHERE id=$1', [profile.area_id])).rows[0]?.slug || '' : '';
    return { user, profile, permissions: effectivePermissions(permissions, areaSlug) };
  }
  function allowed(ctx, resource, level = 'view') {
    if (!ctx || ctx.profile.active === false) return false;
    if (ctx.profile.role === 'super_admin') return true;
    if (resource === 'feed' && ctx.profile.role === 'staff' && level === 'manage') return true;
    const areaLevel = LEVELS[ctx.permissions[resource]] || 0;
    return areaLevel >= LEVELS[level] && (level === 'view' || ROLE_RANK[ctx.profile.role] >= ROLE_RANK.area_manager);
  }
  async function requireAccess(req, res, resource, level) {
    const ctx = await context(req);
    if (!ctx) { send(res, 401, { error: 'Faça login para continuar.' }); return null; }
    if (ctx.profile.active === false) { send(res, 403, { error: 'Este perfil está desativado.' }); return null; }
    if (resource && !allowed(ctx, resource, level)) { send(res, 403, { error: 'Seu perfil não possui permissão para esta ação.' }); return null; }
    return ctx;
  }
  async function me(req, res) {
    const ctx = await requireAccess(req, res); if (!ctx) return;
    return send(res, 200, { profile: ctx.profile, permissions: ctx.permissions, resources: RESOURCES, isSuperAdmin: ctx.profile.role === 'super_admin', canModerateFeed: ctx.profile.role === 'staff' || ctx.profile.role === 'super_admin', canManageAnnouncements: allowed(ctx, 'hero_announcements', 'manage'), canManageCelebrations: allowed(ctx, 'celebration_templates', 'manage'), canManageRanking: allowed(ctx, 'ranking', 'manage') || ctx.profile.role === 'super_admin' });
  }
  async function areas(req, res) {
    const ctx = await requireAccess(req, res); if (!ctx) return;
    if (ctx.profile.role !== 'super_admin') return send(res, 403, { error: 'Apenas o administrador principal pode gerenciar áreas.' });
    if (req.method === 'GET') {
      const [areaRows, permissionRows] = await Promise.all([db().query('SELECT id,name,slug,description,active,created_at FROM public.portal_areas ORDER BY name'), db().query('SELECT area_id,resource,access_level FROM public.area_permissions ORDER BY resource')]);
      return send(res, 200, { areas: areaRows.rows.map(area => ({ ...area, permissions: effectivePermissions(Object.fromEntries(permissionRows.rows.filter(p => p.area_id === area.id).map(p => [p.resource, p.access_level])), area.slug) })), resources: RESOURCES });
    }
    if (req.method === 'POST') {
      const input = await parseBody(req); const name = cleanText(input.name, 80); const description = cleanText(input.description, 240);
      const slug = cleanText(input.slug || name, 80).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!name || !slug) return send(res, 400, { error: 'Informe o nome da área.' });
      const created = await db().query('INSERT INTO public.portal_areas(name,slug,description) VALUES($1,$2,$3) RETURNING *', [name, slug, description]);
      return send(res, 201, created.rows[0]);
    }
    if (req.method === 'PUT') {
      const input = await parseBody(req); const areaId = cleanText(input.areaId, 80);
      if (!areaId) return send(res, 400, { error: 'Área inválida.' });
      if (input.permissions && typeof input.permissions === 'object') for (const [resource, level] of Object.entries(input.permissions)) {
        if (!RESOURCES.includes(resource) || !(level in LEVELS)) continue;
        await db().query('INSERT INTO public.area_permissions(area_id,resource,access_level) VALUES($1,$2,$3) ON CONFLICT(area_id,resource) DO UPDATE SET access_level=EXCLUDED.access_level', [areaId, resource, level]);
      }
      if (typeof input.active === 'boolean') await db().query('UPDATE public.portal_areas SET active=$2,updated_at=now() WHERE id=$1', [areaId, input.active]);
      return send(res, 200, { saved: true });
    }
    return send(res, 405, { error: 'Método não permitido.' });
  }
  async function users(req, res) {
    const ctx = await requireAccess(req, res); if (!ctx) return;
    if (ctx.profile.role !== 'super_admin') return send(res, 403, { error: 'Apenas o administrador principal pode gerenciar perfis.' });
    if (req.method === 'GET') {
      const result = await db().query('SELECT p.user_id,p.email,p.display_name,p.role,p.area_id,p.active,p.created_at,a.name area_name FROM public.user_profiles p LEFT JOIN public.portal_areas a ON a.id=p.area_id ORDER BY p.display_name');
      return send(res, 200, { users: result.rows });
    }
    if (req.method === 'POST') {
      const input = await parseBody(req);
      const displayName = cleanText(input.displayName, 120);
      const email = cleanText(input.email, 180).toLowerCase();
      const role = cleanText(input.role, 30) || 'member';
      const areaId = cleanText(input.areaId, 80) || null;
      const userId = cleanText(input.userId, 160) || `manual:${email}`;
      if (!displayName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Informe nome e e-mail válidos.' });
      if (!(role in ROLE_RANK)) return send(res, 400, { error: 'Perfil inválido.' });
      const existing = await db().query('SELECT user_id FROM public.user_profiles WHERE email=$1 OR user_id=$2', [email, userId]);
      if (existing.rowCount) return send(res, 409, { error: 'Já existe um perfil com esse e-mail ou identificador.' });
      const created = await db().query(
        'INSERT INTO public.user_profiles(user_id,email,display_name,role,area_id,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [userId, email, displayName, role, areaId, input.active !== false]
      );
      return send(res, 201, created.rows[0]);
    }
    if (req.method === 'PUT') {
      const input = await parseBody(req); const userId = cleanText(input.userId, 160); const role = cleanText(input.role, 30); const areaId = cleanText(input.areaId, 80) || null;
      if (!userId || !(role in ROLE_RANK)) return send(res, 400, { error: 'Perfil ou papel inválido.' });
      const target = await db().query('SELECT email FROM public.user_profiles WHERE user_id=$1', [userId]);
      if (target.rows[0]?.email === PRIMARY_ADMIN_EMAIL && role !== 'super_admin') return send(res, 409, { error: 'O administrador principal não pode perder esse papel.' });
      const updated = await db().query('UPDATE public.user_profiles SET role=$2,area_id=$3,active=$4,updated_at=now() WHERE user_id=$1 RETURNING *', [userId, role, areaId, input.active !== false]);
      return send(res, 200, updated.rows[0]);
    }
    return send(res, 405, { error: 'Método não permitido.' });
  }
  async function moderateFeed(req, res) {
    const ctx = await requireAccess(req, res); if (!ctx) return;
    if (!['staff','super_admin'].includes(ctx.profile.role)) return send(res, 403, { error: 'Apenas a moderação pode realizar esta ação.' });
    if (req.method !== 'PUT') return send(res, 405, { error: 'Método não permitido.' });
    const input = await parseBody(req); const postId = cleanText(input.postId, 80);
    if (!postId) return send(res, 400, { error: 'Publicação inválida.' });
    const result = await db().query('UPDATE public.feed_posts SET hidden_at=CASE WHEN $2 THEN now() ELSE NULL END,hidden_by=CASE WHEN $2 THEN $3 ELSE NULL END WHERE id=$1 RETURNING id,hidden_at', [postId, input.hidden === true, ctx.user.id]);
    return send(res, 200, result.rows[0] || {});
  }
  function payload(input) { return { title: cleanText(input.title, 81), subtitle: cleanText(input.subtitle, 141), body: cleanText(input.body, 321), url: safeUrl(input.url), startsAt: input.startsAt ? new Date(input.startsAt) : new Date(), expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, active: input.active !== false }; }
  function valid(item) { return item.title && item.title.length <= 80 && item.subtitle.length <= 140 && item.body && item.body.length <= 320 && item.url && !Number.isNaN(item.startsAt?.valueOf()) && !Number.isNaN(item.expiresAt?.valueOf()) && item.expiresAt > item.startsAt; }
  async function announcements(req, res, url) {
    if (req.method === 'GET' && url.searchParams.get('public') === '1') {
      const result = await db().query('SELECT id,title,subtitle,body,url,starts_at,expires_at FROM public.hero_announcements WHERE active=true AND starts_at<=now() AND expires_at>now() ORDER BY starts_at DESC LIMIT 3');
      return send(res, 200, { announcements: result.rows });
    }
    const ctx = await requireAccess(req, res, 'hero_announcements', req.method === 'GET' ? 'view' : 'manage'); if (!ctx) return;
    if (req.method === 'GET') return send(res, 200, { announcements: (await db().query('SELECT id,title,subtitle,body,url,starts_at,expires_at,active,created_at,updated_at FROM public.hero_announcements ORDER BY created_at DESC LIMIT 3')).rows });
    const input = await parseBody(req); const item = payload(input);
    if (!valid(item)) return send(res, 400, { error: 'Confira os limites dos textos, o link e a validade.' });
    if (req.method === 'POST') {
      const count = await db().query('SELECT count(*)::int total FROM public.hero_announcements WHERE active=true AND expires_at>now()');
      if (count.rows[0].total >= 3) return send(res, 409, { error: 'O RH pode manter no máximo três slides ativos.' });
      const created = await db().query('INSERT INTO public.hero_announcements(author_user_id,title,subtitle,body,url,starts_at,expires_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [ctx.user.id, item.title, item.subtitle, item.body, item.url, item.startsAt, item.expiresAt, item.active]);
      return send(res, 201, created.rows[0]);
    }
    if (req.method === 'PUT') {
      const id = cleanText(input.id, 80); if (!id) return send(res, 400, { error: 'Comunicado inválido.' });
      const updated = await db().query('UPDATE public.hero_announcements SET title=$2,subtitle=$3,body=$4,url=$5,starts_at=$6,expires_at=$7,active=$8,updated_at=now() WHERE id=$1 RETURNING *', [id, item.title, item.subtitle, item.body, item.url, item.startsAt, item.expiresAt, item.active]);
      return send(res, 200, updated.rows[0]);
    }
    return send(res, 405, { error: 'Método não permitido.' });
  }
  async function authorize(req,res,resource,level='view'){return requireAccess(req,res,resource,level);}
  async function ensureCelebrationImageColumns(){
    await db().query(`ALTER TABLE public.celebration_email_templates
      ADD COLUMN IF NOT EXISTS image_base bytea,
      ADD COLUMN IF NOT EXISTS image_mime text,
      ADD COLUMN IF NOT EXISTS photo_x_pct numeric NOT NULL DEFAULT 72,
      ADD COLUMN IF NOT EXISTS photo_y_pct numeric NOT NULL DEFAULT 48,
      ADD COLUMN IF NOT EXISTS photo_size_pct numeric NOT NULL DEFAULT 24`);
  }
  function decodeTemplateImage(value){
    if(!value)return null;
    const match=String(value).match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
    if(!match)throw new Error('IMAGE_INVALID');
    const buffer=Buffer.from(match[2],'base64');
    if(!buffer.length||buffer.length>2500000)throw new Error('IMAGE_INVALID');
    return {buffer,mime:match[1]};
  }  async function celebrationTemplates(req,res){
    const ctx=await requireAccess(req,res,'celebration_templates','manage');if(!ctx)return;
    await ensureCelebrationImageColumns();
    const currentYear=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric'}).format(new Date()));
    if(req.method==='GET'){
      const requested=Number(new URL(req.url,'http://localhost').searchParams.get('year')||currentYear);
      const rows=await db().query(`SELECT event_type,template_year,subject_template,headline,message_html,active,updated_at,image_mime,
        image_base IS NOT NULL has_image,
        photo_x_pct::float,photo_y_pct::float,photo_size_pct::float
        FROM public.celebration_email_templates WHERE template_year=$1 ORDER BY event_type`,[requested]);
      return send(res,200,{year:requested,templates:rows.rows});
    }
    if(req.method==='PUT'){
      const input=await parseBody(req,3500000),eventType=cleanText(input.eventType,24),templateYear=Number(input.templateYear),subject=cleanText(input.subjectTemplate,180),headline=cleanText(input.headline,120),messageHtml=cleanText(input.messageHtml,6000);
      const photoX=Number(input.photoXPct??72),photoY=Number(input.photoYPct??48),photoSize=Number(input.photoSizePct??24);
      let image=null;try{image=decodeTemplateImage(input.imageBase);}catch{return send(res,400,{error:'Envie uma imagem-base JPG ou PNG de até 2,5 MB.'});}
      if(!['birthday','work_anniversary'].includes(eventType)||templateYear<currentYear||templateYear>currentYear+5||!subject||!headline||!messageHtml||photoX<0||photoX>100||photoY<0||photoY>100||photoSize<10||photoSize>60)return send(res,400,{error:'Confira o ano, os textos e a posição da foto.'});
      const result=await db().query(`INSERT INTO public.celebration_email_templates(event_type,template_year,subject_template,headline,message_html,active,updated_by,image_base,image_mime,photo_x_pct,photo_y_pct,photo_size_pct)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(event_type,template_year) DO UPDATE SET subject_template=EXCLUDED.subject_template,headline=EXCLUDED.headline,message_html=EXCLUDED.message_html,active=EXCLUDED.active,updated_by=EXCLUDED.updated_by,updated_at=now(),
        image_base=COALESCE(EXCLUDED.image_base,celebration_email_templates.image_base),image_mime=COALESCE(EXCLUDED.image_mime,celebration_email_templates.image_mime),photo_x_pct=EXCLUDED.photo_x_pct,photo_y_pct=EXCLUDED.photo_y_pct,photo_size_pct=EXCLUDED.photo_size_pct RETURNING event_type,template_year,active,updated_at`,
        [eventType,templateYear,subject,headline,messageHtml,input.active!==false,ctx.user.id,image?.buffer||null,image?.mime||null,photoX,photoY,photoSize]);
      return send(res,200,result.rows[0]);
    }
    return send(res,405,{error:'Método não permitido.'});
  }
  async function celebrationTemplateImage(req,res){
    const ctx=await requireAccess(req,res,'celebration_templates','manage');if(!ctx)return;
    const url=new URL(req.url,'http://localhost'),eventType=cleanText(url.searchParams.get('type'),24),templateYear=Number(url.searchParams.get('year'));
    if(!['birthday','work_anniversary'].includes(eventType)||!Number.isInteger(templateYear))return send(res,400,{error:'Imagem de modelo inválida.'});
    const row=(await db().query('SELECT image_base,image_mime,updated_at FROM public.celebration_email_templates WHERE event_type=$1 AND template_year=$2',[eventType,templateYear])).rows[0];
    if(!row?.image_base)return send(res,404,{error:'Imagem-base não encontrada.'});
    res.writeHead(200,{'Content-Type':row.image_mime||'image/png','Content-Length':row.image_base.length,'Cache-Control':'private, no-cache','Last-Modified':new Date(row.updated_at).toUTCString()});
    res.end(row.image_base);
  }
  return { me, areas, users, moderateFeed, announcements, celebrationTemplates, celebrationTemplateImage, authorize };
};
