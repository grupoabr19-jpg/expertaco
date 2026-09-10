(function(){
  const pathFor=id=>id==='visao'?'/':'/'+id;
  const route=()=>decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g,'')||'visao');
  const valid=id=>sections.some(s=>s.id===id);
  const clean=id=>valid(id)?id:'visao';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let profileSearchToken=0;

  renderNav=function(){
    const current=clean(route());
    const link=(id,label,extra='')=>'<a href="'+pathFor(id)+'" data-route="'+id+'" class="'+(current===id?'active ':'')+extra+'"><span class="nav-label">'+label+'</span></a>';
    const scriptsActive=['prospeccao','objecoes','posvenda','crise'].includes(current);
    document.querySelector('#sideNav').innerHTML=
      link('ranking','Ranking','nav-ranking')+
      link('conta','Minha area','nav-account')+
      link('feed','Feed')+
      link('visao','Visao geral')+
      link('regras','Regras de ouro')+
      link('portfolio','Portfolio')+
      '<details class="nav-group" '+(scriptsActive?'open':'')+'><summary class="'+(scriptsActive?'active':'')+'"><span>Playbook de Vendas</span><span class="nav-chevron">⌄</span></summary><div class="nav-submenu">'+
        '<a href="/prospeccao#script-operacional">Roteiro completo</a>'+
        '<a href="/prospeccao#abertura">Abertura da conversa</a>'+
        '<a href="/prospeccao#spin">Diagnostico SPIN</a>'+
        '<a href="/prospeccao#ponte">Ponte para valor</a>'+
        '<a href="/prospeccao#fechamento">Proximo passo</a>'+
        '<a href="/objecoes">Quebra de objecoes</a>'+
        '<a href="/posvenda">Pos-venda</a>'+
        '<a href="/crise">Gestao de crise</a>'+
      '</div></details>'+
      link('ideaaco','#IdeACO')+
      link('reativacao','Projeto Guerra')+
      '<a href="https://drive.google.com/drive/folders/1h-d8hoZII-m0oRe8xv5A6nP0EycLcXm3?usp=sharing" target="_blank" rel="noopener" class="nav-external"><span class="nav-label">Materiais de marketing</span><span aria-hidden="true">-></span></a>'+
      '<span class="nav-divider">Mais recursos</span>'+
      link('kommo','Qualificacao Kommo')+
      link('blog','Blog e noticias');
  };

  function cardMarkup(card){
    return '<article class="card '+(card.script?'highlight':'')+'" id="'+esc(card.id)+'" data-id="'+esc(card.id)+'"><div class="card-tools"><button class="favorite-button '+(state.favorites.has(card.id)?'active':'')+'" aria-label="Favoritar '+esc(card.title)+'" title="Favoritar">★</button>'+(card.script?'<button class="copy-button" aria-label="Copiar '+esc(card.title)+'" title="Copiar script">Copiar</button>':'')+'</div><h2>'+esc(card.title)+'</h2><div class="card-body">'+card.html+'</div><footer>'+card.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</footer></article>';
  }

  function groupedSearchCards(){
    return sections.map(section=>({section,cards:cards.filter(card=>card.section===section.id&&visible(card))})).filter(group=>group.cards.length);
  }

  async function renderProfileSearch(query,token){
    const host=document.querySelector('#profileSearchResults');if(!host)return;
    host.innerHTML='<div class="feed-empty">Consultando perfis...</div>';
    try{
      const response=await fetch('/api/profiles?q='+encodeURIComponent(query),{credentials:'same-origin'});
      if(token!==profileSearchToken)return;
      if(response.status===401){host.innerHTML='<div class="feed-empty">Entre na conta para buscar perfis de colaboradores.</div>';return;}
      const data=await response.json();const profiles=data.profiles||[];
      if(!profiles.length){host.innerHTML='<div class="feed-empty">Nenhum perfil encontrado.</div>';return;}
      host.innerHTML=profiles.map(profile=>'<article class="profile-result-card" data-profile-id="'+esc(profile.user_id)+'"><div class="feed-avatar">'+(profile.has_photo?'<img src="/api/profile/photo?id='+encodeURIComponent(profile.user_id)+'" alt="Foto de '+esc(profile.display_name)+'">':esc((profile.display_name||'U').charAt(0).toUpperCase()))+'</div><div><h3>'+esc(profile.display_name)+'</h3><p>'+esc(profile.area_name||'Sem setor definido')+'</p><small>'+esc(profile.email)+'</small>'+(profile.mood?'<span class="profile-result-mood">'+esc(profile.mood)+'</span>':'')+'</div><button type="button" class="button secondary">Ver perfil</button></article>').join('');
    }catch(error){if(token===profileSearchToken)host.innerHTML='<div class="feed-empty">Nao foi possivel consultar perfis agora.</div>';}
  }

  async function openProfile(userId){
    try{
      const response=await fetch('/api/profiles?id='+encodeURIComponent(userId),{credentials:'same-origin'});
      if(!response.ok)throw new Error('Nao foi possivel abrir o perfil.');
      const profile=(await response.json()).profiles?.[0];if(!profile)throw new Error('Perfil nao encontrado.');
      let modal=document.querySelector('#profileViewModal');
      if(!modal){modal=document.createElement('div');modal.id='profileViewModal';modal.className='product-modal';document.body.appendChild(modal);}
      modal.hidden=false;document.body.classList.add('modal-open');
      modal.innerHTML='<div class="product-modal-backdrop" data-profile-close></div><section class="product-modal-dialog profile-view-dialog"><button class="product-modal-close" type="button" data-profile-close>×</button><div class="profile-view-head"><div class="profile-avatar">'+(profile.has_photo?'<img src="/api/profile/photo?id='+encodeURIComponent(profile.user_id)+'" alt="Foto de '+esc(profile.display_name)+'">':esc((profile.display_name||'U').charAt(0).toUpperCase()))+'</div><div><span class="section-kicker">PERFIL</span><h2>'+esc(profile.display_name)+'</h2><p>'+esc(profile.area_name||'Sem setor definido')+'</p>'+(profile.mood?'<strong>'+esc(profile.mood)+'</strong>':'')+'</div></div>'+(profile.bio?'<p class="profile-view-bio">'+esc(profile.bio)+'</p>':'')+'<div class="profile-view-links">'+[['LinkedIn',profile.linkedin_url],['Instagram',profile.instagram_url],['Facebook',profile.facebook_url],['E-mail','mailto:'+profile.email]].filter(item=>item[1]).map(item=>'<a href="'+esc(item[1])+'" target="'+(item[0]==='E-mail'?'_self':'_blank')+'" rel="noopener">'+item[0]+'</a>').join('')+'</div>'+(profile.signature_url?'<img class="feed-signature" src="'+esc(profile.signature_url)+'" alt="Assinatura de '+esc(profile.display_name)+'">':'')+'</section>';
    }catch(error){toast(error.message);}
  }

  renderContent=function(){
    const current=clean(route()),section=sections.find(s=>s.id===current),m=meta[current]||['',section.label,''];
    const commercial=['prospeccao','followup','objecoes','fechamento','posvenda','crise'].includes(current);
    const host=document.querySelector('#playbookContent');let count=0;
    if(state.query){
      const groups=groupedSearchCards();count=groups.reduce((total,group)=>total+group.cards.length,0);
      host.innerHTML='<section class="playbook-section content-section route-page global-search-page"><header class="section-heading"><div><span class="section-kicker">BUSCA GLOBAL</span><h1>Resultados para "'+esc(state.query)+'"</h1></div><p>Conteudos do portal separados por titulo de secao, incluindo perfis de colaboradores.</p></header><section class="search-group"><h2>Perfis</h2><div id="profileSearchResults" class="profile-results"></div></section>'+groups.map(group=>'<section class="search-group" id="'+esc(group.section.id)+'"><h2>'+esc((meta[group.section.id]||['',group.section.label])[1])+'</h2><div class="grid">'+group.cards.map(cardMarkup).join('')+'</div></section>').join('')+(groups.length?'':'<div class="feed-empty">Nenhum conteudo do portal encontrado.</div>')+'</section>';
      renderProfileSearch(state.query,++profileSearchToken);
    }else{
      const sectionCards=cards.filter(card=>card.section===current&&visible(card));count=sectionCards.length;
      host.innerHTML='<section id="'+esc(current)+'" class="playbook-section content-section route-page"><header class="section-heading"><div><span class="section-kicker">'+(commercial?'PLAYBOOK DE VENDAS':'INTRANET #PARCEIRACO')+'</span><h1>'+esc(m[1])+'</h1></div><p>'+esc(m[2])+'</p></header><div class="grid">'+sectionCards.map(cardMarkup).join('')+'</div></section>';
    }
    const summary=document.querySelector('#searchSummary');
    summary.hidden=!state.query&&state.filter==='todos';
    summary.textContent=state.query?'Busca global ativa: '+count+' conteudo'+(count===1?'':'s')+' do portal encontrado'+(count===1?'':'s')+', alem dos perfis.':count+' conteudo'+(count===1?'':'s')+' encontrado'+(count===1?'':'s')+'.';
    bindCards();renderNav();
  };

  async function applyRoute(){
    if(window.portalRequireSession&&!(await window.portalRequireSession()))return;
    const current=clean(route()),home=current==='visao';
    document.body.dataset.route=current;
    document.querySelector('#inicio').hidden=!home;
    document.querySelector('.quick-panel').hidden=home;
    document.querySelector('#contatos').hidden=home;
    renderContent();
    document.querySelector('#sidebar').classList.remove('open');
    document.querySelector('#backdrop').classList.remove('show');
    document.querySelector('#menuButton').setAttribute('aria-expanded','false');
    const target=location.hash&&document.querySelector(location.hash);
    if(target)requestAnimationFrame(()=>target.scrollIntoView({block:'start'}));else scrollTo({top:0,behavior:'instant'});
  }

  document.addEventListener('click',e=>{
    const profile=e.target.closest('.profile-result-card');
    if(profile){openProfile(profile.dataset.profileId);return;}
    if(e.target.closest('[data-profile-close]')){document.querySelector('#profileViewModal').hidden=true;document.body.classList.remove('modal-open');return;}
    const a=e.target.closest('a');
    if(!a)return;
    const url=new URL(a.href,location.href);
    if(url.origin!==location.origin||a.target==='_blank'||url.pathname.endsWith('.pdf'))return;
    const hashRoute=url.hash&&url.hash.length>1?url.hash.slice(1):null;
    const routeId=url.pathname.replace(/^\//,'')||'visao';
    const next=hashRoute&&valid(hashRoute)?pathFor(hashRoute):url.pathname+url.hash;
    if(!valid(routeId))return;
    e.preventDefault();history.pushState({},'',next);applyRoute();
  });
  addEventListener('popstate',applyRoute);
  const heroObserver=new MutationObserver(()=>document.querySelectorAll('#inicio a[href^="#"]').forEach(a=>a.href='/'+a.getAttribute('href').slice(1)));
  heroObserver.observe(document.querySelector('#inicio'),{childList:true,subtree:true});
  document.querySelector('.brand').href='/';
  document.querySelector('.topnav').innerHTML='<a href="/">Inicio</a><a href="/feed">Feed</a><a href="/prospeccao">Playbook de Vendas</a><a href="/portfolio">Portfolio</a><a href="/ranking">Ranking</a><a href="/kommo">Kommo</a>';
  applyRoute();
})();
