(function(){
  if(!sections.some(item=>item.id==='conta'))sections.splice(2,0,{id:'conta',icon:'U',label:'Minha area'});
  if(!sections.some(item=>item.id==='feed'))sections.splice(3,0,{id:'feed',icon:'F',label:'Feed'});
  meta.conta=['','Minha area','Seu perfil, suas conexoes e suas informacoes na intranet.'];
  meta.feed=['','Feed','Atualizacoes gerais e publicacoes por equipe.'];
  cards.push(
    {id:'user-area',section:'conta',audience:'todos',title:'Area do colaborador',tags:['conta','perfil'],html:'<div id="authArea" class="auth-area"><p>Verificando sua sessao...</p></div>'},
    {id:'team-feed',section:'feed',audience:'todos',title:'Feed da intranet',tags:['feed','comunidade'],html:'<div id="feedArea" class="auth-area"><p>Carregando feed...</p></div>'}
  );

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let pendingPhotoData='',feedScope='general',loginRedirect='',cropBitmap=null,cropState={x:0,y:0,zoom:1,dragging:false,startX:0,startY:0,baseX:0,baseY:0};
  const normalize=data=>data?.user?data:data?.data?.user?data.data:data?.session?.user?data.session:null;
  async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error||'Nao foi possivel concluir a operacao.');return data;}
  const authApi=(route,options)=>api('/api/auth/'+route,options);

  function updateHeader(session){
    document.querySelectorAll('.user-header,.user-header-logout').forEach(item=>item.remove());
    const host=document.querySelector('.header-actions');if(!host)return;
    const user=session?.user,link=document.createElement('a');
    link.className='user-header';link.href='/conta';
    link.innerHTML=user?'<span class="user-header-avatar">'+esc((user.name||user.email||'U').charAt(0).toUpperCase())+'</span><span>Bem-vindo(a), <b>'+esc(user.name||user.email.split('@')[0])+'</b></span>':'<span class="user-header-avatar">U</span><span>Entrar</span>';
      host.prepend(link);
      if(user){
        const logout=document.createElement('button');
        logout.type='button';logout.className='user-header-logout';logout.dataset.authLogout='1';logout.textContent='Sair';logout.setAttribute('aria-label','Sair da conta');
        host.insertBefore(logout,link.nextSibling);
      }
  }

  function loginMarkup(message=''){
    return '<div class="auth-shell"><div class="auth-copy"><span class="section-kicker">AMBIENTE CORPORATIVO</span><h3>Entre na #ParceirACO</h3><p>Use exclusivamente seu endereco profissional terminado em <b>@grupoabr.com.br</b>.</p><div class="warning"><b>Acesso protegido</b><span>Nao compartilhe sua senha ou sua sessao com outras pessoas.</span></div></div><div class="auth-panel">'+(message?'<p class="auth-message">'+esc(message)+'</p>':'')+'<div class="auth-tabs"><button type="button" class="active" data-auth-tab="login">Entrar</button><button type="button" data-auth-tab="register">Criar conta</button></div><form id="loginForm" class="auth-form"><label>E-mail corporativo<input name="email" type="email" required autocomplete="email" placeholder="nome@grupoabr.com.br"></label><label>Senha<input name="password" type="password" minlength="8" required autocomplete="current-password"></label><button class="button primary" type="submit">Entrar</button></form><form id="registerForm" class="auth-form" hidden><label>Nome completo<input name="name" required autocomplete="name"></label><label>E-mail corporativo<input name="email" type="email" required autocomplete="email" placeholder="nome@grupoabr.com.br"></label><label>Senha<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><small>Use no minimo oito caracteres.</small><button class="button primary" type="submit">Criar conta</button></form></div></div>';
  }

  function requestedPath(){
    return location.pathname+location.search+location.hash;
  }

  function showLoginGate(message='Entre para acessar a intranet.'){
    loginRedirect=requestedPath();
    document.body.classList.add('auth-gate-active');
    updateHeader(null);
    const home=document.querySelector('#inicio'),quick=document.querySelector('.quick-panel'),contacts=document.querySelector('#contatos'),summary=document.querySelector('#searchSummary'),host=document.querySelector('#playbookContent');
    if(home)home.hidden=true;if(quick)quick.hidden=true;if(contacts)contacts.hidden=true;if(summary)summary.hidden=true;
    if(host)host.innerHTML='<section class="playbook-section content-section route-page login-gate-page"><header class="section-heading"><div><span class="section-kicker">ACESSO RESTRITO</span><h1>Login da intranet</h1></div><p>Depois de entrar, voce volta automaticamente para o link que tentou abrir.</p></header>'+loginMarkup(message)+'</section>';
  }

  async function requireSession(){
    const session=await currentSession();
    updateHeader(session);
    if(session){document.body.classList.remove('auth-gate-active');window.loadRanking?.();return session;}
    showLoginGate();
    return null;
  }

  function profileMarkup(session,profile){
    const user=session.user,initial=esc((profile.display_name||user.name||'U').charAt(0).toUpperCase());
    return '<div class="member-layout profile-only"><aside class="member-profile"><div class="profile-heading"><div class="profile-avatar profile-photo-preview">'+(profile.photo_url?'<img src="'+esc(profile.photo_url)+'" alt="Foto de '+esc(profile.display_name)+'">':initial)+'</div><div><span class="section-kicker">MEU PERFIL</span><h3>'+esc(profile.display_name)+'</h3><small>'+esc(user.email)+'</small></div></div><form id="profileForm" class="profile-form"><label>Nome de exibicao<input name="displayName" maxlength="120" required value="'+esc(profile.display_name)+'"></label><label>Mini bio <small><span id="bioCount">'+esc((profile.bio||'').length)+'</span>/300</small><textarea name="bio" maxlength="300" rows="5" placeholder="Conte brevemente sobre voce...">'+esc(profile.bio||'')+'</textarea></label><label>Como voce esta se sentindo?<input name="mood" maxlength="80" value="'+esc(profile.mood||'')+'" placeholder="Ex.: animado, focado, agradecido..."></label><label>Data de aniversario<input name="birthDate" type="date" required value="'+esc(profile.birth_date?String(profile.birth_date).slice(0,10):'')+'"></label><label>Entrada na empresa<input name="hireDate" type="date" required value="'+esc(profile.hire_date?String(profile.hire_date).slice(0,10):'')+'"></label><label>Foto do perfil <small>Arraste e ajuste para 400 x 400 px</small><input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><div id="photoCropper" class="photo-cropper" hidden><div class="photo-crop-frame"><img id="photoCropImage" alt="Ajuste da foto"></div><label>Zoom<input id="photoZoom" type="range" min="1" max="3" step=".05" value="1"></label><button type="button" class="button secondary" id="applyPhotoCrop">Aplicar corte</button></div><label>Assinatura do forum <small>PNG, JPG, GIF ou WEBP por link</small><input name="signatureUrl" type="url" value="'+esc(profile.signature_url||'')+'" placeholder="https://site.com/minha-assinatura.gif"></label><label>LinkedIn<input name="linkedinUrl" type="url" value="'+esc(profile.linkedin_url||'')+'" placeholder="https://linkedin.com/in/..."></label><label>Instagram<input name="instagramUrl" type="url" value="'+esc(profile.instagram_url||'')+'" placeholder="https://instagram.com/..."></label><label>Facebook<input name="facebookUrl" type="url" value="'+esc(profile.facebook_url||'')+'" placeholder="https://facebook.com/..."></label><button class="button primary" type="submit">Salvar perfil</button></form><button type="button" class="profile-signout" data-auth-logout>Sair da conta</button></aside></div>';
  }

  function socialLink(url,label){return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">'+label+' -></a>':'';}
  function feedMarkup(posts){
    if(!posts.length)return '<div class="feed-empty">Ainda nao ha publicacoes neste feed.</div>';
    return posts.map(post=>'<article class="feed-post" data-post-id="'+esc(post.id)+'"><div class="feed-avatar">'+(post.has_photo?'<img src="/api/profile/photo?id='+encodeURIComponent(post.user_id)+'" alt="Foto de '+esc(post.display_name)+'">':esc((post.display_name||'U').charAt(0).toUpperCase()))+'</div><div><header><span><b>'+esc(post.display_name)+'</b>'+(post.area_name?'<small>'+esc(post.area_name)+'</small>':'')+'</span><time>'+new Date(post.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})+'</time></header><p>'+esc(post.content)+'</p><footer>'+socialLink(post.linkedin_url,'LinkedIn')+socialLink(post.instagram_url,'Instagram')+socialLink(post.facebook_url,'Facebook')+'</footer>'+(post.signature_url?'<img class="feed-signature" src="'+esc(post.signature_url)+'" alt="Assinatura de '+esc(post.display_name)+'" loading="lazy">':'')+'</div></article>').join('');
  }

  function feedShell(feed){
    return '<section class="member-feed feed-page"><div class="feed-composer"><span class="section-kicker">FEED #PARCEIRACO</span><h3>Compartilhe uma atualizacao</h3><form id="postForm"><textarea name="content" maxlength="500" rows="4" required placeholder="Informe novidades do time, aprendizados, avisos ou boas praticas..."></textarea><div class="feed-compose-actions"><fieldset class="feed-scope"><label><input type="radio" name="visibility" value="general" '+(feedScope==='general'?'checked':'')+'> Geral</label><label><input type="radio" name="visibility" value="team" '+(feedScope==='team'?'checked':'')+'> Minha equipe</label></fieldset><small>Ate 500 caracteres</small><button class="button primary" type="submit">Publicar</button></div></form></div><div class="feed-tabs"><button type="button" data-feed-scope="general" class="'+(feedScope==='general'?'active':'')+'">Feed geral</button><button type="button" data-feed-scope="team" class="'+(feedScope==='team'?'active':'')+'">Minha equipe</button></div><div id="feedList" class="feed-list">'+feedMarkup(feed.posts||[])+'</div></section>';
  }

  function updateCropPreview(){
    const image=document.querySelector('#photoCropImage'),zoom=document.querySelector('#photoZoom');
    if(!image)return;
    if(zoom)zoom.value=String(cropState.zoom);
    image.style.transform='translate(calc(-50% + '+cropState.x+'px), calc(-50% + '+cropState.y+'px)) scale('+cropState.zoom+')';
  }

  async function loadCropper(file){
    if(file.size>8000000){toast('Escolha uma imagem de ate 8 MB.');return false;}
    cropBitmap=await createImageBitmap(file);pendingPhotoData='';
    cropState={x:0,y:0,zoom:1,dragging:false,startX:0,startY:0,baseX:0,baseY:0};
    const cropper=document.querySelector('#photoCropper'),image=document.querySelector('#photoCropImage');
    if(cropper&&image){image.src=URL.createObjectURL(file);cropper.hidden=false;updateCropPreview();}
    return true;
  }

  function applyCrop(){
    if(!cropBitmap)return toast('Escolha uma imagem antes de aplicar o corte.');
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    canvas.width=400;canvas.height=400;
    const scale=Math.max(400/cropBitmap.width,400/cropBitmap.height)*cropState.zoom;
    const width=cropBitmap.width*scale,height=cropBitmap.height*scale;
    ctx.drawImage(cropBitmap,(400-width)/2+cropState.x,(400-height)/2+cropState.y,width,height);
    pendingPhotoData=canvas.toDataURL('image/jpeg',.86);
    const preview=document.querySelector('.profile-photo-preview');
    if(preview)preview.innerHTML='<img src="'+pendingPhotoData+'" alt="Previa da foto">';
    toast('Corte aplicado. Salve o perfil para confirmar.');
  }

  async function currentSession(){try{return normalize(await authApi('get-session',{method:'GET'}));}catch{return null;}}
  async function renderArea(){
    const host=document.querySelector('#authArea'),session=await currentSession();updateHeader(session);if(!host)return;
    if(!session){host.innerHTML=loginMarkup();return;}
    try{host.innerHTML=profileMarkup(session,await api('/api/profile'));}catch(error){host.innerHTML='<p class="auth-message">'+esc(error.message)+'</p>';}
  }
  async function renderFeed(){
    const host=document.querySelector('#feedArea'),session=await currentSession();updateHeader(session);if(!host)return;
    if(!session){host.innerHTML=loginMarkup('Entre para publicar e acompanhar o feed.');return;}
    try{host.innerHTML=feedShell(await api('/api/feed?scope='+encodeURIComponent(feedScope)));}catch(error){host.innerHTML='<p class="auth-message">'+esc(error.message)+'</p>';}
  }
  async function refreshHeader(){updateHeader(await currentSession());}

  document.addEventListener('click',async event=>{
    const tab=event.target.closest('[data-auth-tab]');
    if(tab){document.querySelectorAll('[data-auth-tab]').forEach(button=>button.classList.toggle('active',button===tab));document.querySelector('#loginForm').hidden=tab.dataset.authTab!=='login';document.querySelector('#registerForm').hidden=tab.dataset.authTab!=='register';return;}
    const feedTab=event.target.closest('[data-feed-scope]');
    if(feedTab){feedScope=feedTab.dataset.feedScope==='team'?'team':'general';await renderFeed();return;}
    if(event.target.closest('#applyPhotoCrop')){applyCrop();return;}
    if(event.target.closest('[data-auth-logout]')){try{await authApi('sign-out',{method:'POST',body:'{}'});}catch{}updateHeader(null);showLoginGate('Voce saiu da conta. Entre novamente para acessar a intranet.');}
  });

  document.addEventListener('pointerdown',event=>{
    const frame=event.target.closest('.photo-crop-frame');if(!frame)return;
    cropState.dragging=true;cropState.startX=event.clientX;cropState.startY=event.clientY;cropState.baseX=cropState.x;cropState.baseY=cropState.y;frame.classList.add('dragging');frame.setPointerCapture?.(event.pointerId);
  });
  document.addEventListener('pointermove',event=>{
    if(!cropState.dragging)return;
    cropState.x=cropState.baseX+event.clientX-cropState.startX;cropState.y=cropState.baseY+event.clientY-cropState.startY;updateCropPreview();
  });
  document.addEventListener('pointerup',event=>{
    if(!cropState.dragging)return;
    cropState.dragging=false;document.querySelector('.photo-crop-frame')?.classList.remove('dragging');
  });

  document.addEventListener('input',async event=>{
    if(event.target.name==='bio'){const count=document.querySelector('#bioCount');if(count)count.textContent=event.target.value.length;}
    if(event.target.id==='photoZoom'){cropState.zoom=Number(event.target.value)||1;updateCropPreview();}
    if(event.target.name==='photo'&&event.target.files?.[0]){try{await loadCropper(event.target.files[0]);toast('Ajuste a foto e clique em Aplicar corte antes de salvar.');}catch{toast('Nao foi possivel processar essa imagem.');}}
  });

  document.addEventListener('submit',async event=>{
    if(!['loginForm','registerForm','profileForm','postForm'].includes(event.target.id))return;
    event.preventDefault();const form=event.target,button=form.querySelector('button[type="submit"]'),values=Object.fromEntries(new FormData(form).entries()),original=button.textContent;button.disabled=true;button.textContent='Aguarde...';
    try{
      if(form.id==='loginForm'||form.id==='registerForm'){if(!/@grupoabr\.com\.br$/i.test(values.email||''))throw new Error('Use seu e-mail @grupoabr.com.br.');await authApi(form.id==='loginForm'?'sign-in/email':'sign-up/email',{method:'POST',body:JSON.stringify(values)});toast(form.id==='loginForm'?'Login realizado.':'Conta criada com sucesso.');const target=loginRedirect||requestedPath()||'/';if(document.body.classList.contains('auth-gate-active')){location.href=target;return;}await renderArea();await renderFeed();}
      else if(form.id==='profileForm'){await api('/api/profile',{method:'PUT',body:JSON.stringify({...values,photoData:pendingPhotoData||undefined})});pendingPhotoData='';cropBitmap=null;toast('Perfil atualizado.');await renderArea();}
      else{feedScope=values.visibility==='team'?'team':'general';await api('/api/feed',{method:'POST',body:JSON.stringify(values)});toast('Publicacao enviada.');await renderFeed();}
    }catch(error){toast(error.message);button.disabled=false;button.textContent=original;}
  });

  new MutationObserver(()=>{
    if(document.body.dataset.route==='conta'&&document.querySelector('#authArea:not([data-ready])')){document.querySelector('#authArea').dataset.ready='1';renderArea();}
    if(document.body.dataset.route==='feed'&&document.querySelector('#feedArea:not([data-ready])')){document.querySelector('#feedArea').dataset.ready='1';renderFeed();}
  }).observe(document.querySelector('#playbookContent'),{childList:true,subtree:true});
  window.portalRequireSession=requireSession;
  window.portalShowLoginGate=showLoginGate;
  renderNav();renderContent();observeSections();refreshHeader();
})();
