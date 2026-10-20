(function () {
'use strict';
const Core = window.VaultCore;
const Store = window.VaultStore;
const $ = id => document.getElementById(id);
let records = [], editing = null, draftImages = [], detailId = null, pendingImport = null;
let view = 'all', category = '', tag = '', toastTimer, toastCallback, saving = false, readingImages = false, importing = false;
const fields = ['title','prompt','negative','model','parameters','category','rating','review','source','videoUrl'];
Object.entries(Core.FIELD_LIMITS).forEach(([field,limit]) => { if($('edit-'+field)) $('edit-'+field).maxLength=limit; });
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => new Date(value).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'});
const errorText = error => error && error.message ? error.message : '操作未完成，请重试。';
function showError(error) { $('error-banner').textContent = errorText(error); $('error-banner').hidden = false; }
function clearError() { $('error-banner').hidden = true; }
function toast(message, callback) {
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  $('toast-action').hidden = !callback;
  toastCallback = callback;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, callback ? 12000 : 5500);
}
function openDialog(id) { $(id).showModal(); }
function closeAll() { document.querySelectorAll('dialog[open]').forEach(el => el.close()); }
function resetFilters() { category = ''; tag = ''; $('search-input').value = ''; $('category-filter').value = ''; }
function render() {
  const live = records.filter(r => !r.deletedAt);
  $('count-all').textContent = live.length;
  $('count-favorites').textContent = live.filter(r=>r.favorite).length;
  $('count-trash').textContent = records.length-live.length;
  const cats = [...new Set(live.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const allCats = [...new Set(records.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  $('category-count').textContent = cats.length;
  $('category-nav').innerHTML = cats.length ? cats.map(c => '<button class="category-item '+(category===c?'active':'')+'" data-category="'+esc(c)+'"><i></i><span>'+esc(c)+'</span><small>'+live.filter(r=>r.category===c).length+'</small></button>').join('') : '<p class="muted-small">在提示词中添加你的分类</p>';
  $('category-options').innerHTML = allCats.map(c=>'<option value="'+esc(c)+'"></option>').join('');
  $('category-filter').innerHTML = '<option value="">全部分类</option>'+allCats.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
  if (category && !allCats.includes(category)) category='';
  $('category-filter').value=category;
  const tagCounts = new Map();
  live.forEach(r=>r.tags.forEach(t=>tagCounts.set(t,(tagCounts.get(t)||0)+1)));
  const tags=[...tagCounts].sort((a,b)=>b[1]-a[1]).slice(0,15);
  $('tag-nav').innerHTML=tags.length ? tags.map(([t])=>'<button class="tag '+(tag===t?'active':'')+'" data-tag="'+esc(t)+'"># '+esc(t)+'</button>').join('') : '<span class="muted-small">你的灵感，自有线索</span>';
  document.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-pressed',el.dataset.view===view);});
  const titles={all:'我的提示词',favorites:'我的收藏',trash:'回收站'};
  $('view-title').innerHTML=titles[view]+'<span class="heading-dot">.</span>';
  $('view-description').textContent=view==='trash'?'暂时放下的灵感，仍有重新拾起的机会。':view==='favorites'?'那些值得再用一次的好点子，放在手边。':'把值得保留的画面，整理成下一次灵感。';
  const list=Core.filterRecords(records,{query:$('search-input').value,category,tag,favorites:view==='favorites',trash:view==='trash',sort:$('sort-select').value});
  $('result-count').textContent=list.length+' 条'+(view==='trash'?'回收记录':'提示词');
  $('active-filter').innerHTML=(category||tag||$('search-input').value)?'<button id="clear-filters" class="filter-reset">'+esc([category,tag?'#'+tag:''].filter(Boolean).join(' / '))+' 清除筛选 ×</button>':'';
  $('records-grid').innerHTML=list.map((r,index)=>card(r,index)).join('');
  const isLibraryEmpty=live.length===0&&view==='all'&&!category&&!tag&&!$('search-input').value;
  $('empty-state').hidden=list.length>0;
  $('empty-state').classList.toggle('compact-empty',!isLibraryEmpty);
  $('guide-row').hidden=!isLibraryEmpty;
  if(isLibraryEmpty) {
    $('empty-title').innerHTML='好画面，<br>值得留下它的起点。';
    $('empty-description').textContent='收藏你亲手验证的提示词，连同参考图、参数和创作心得一起保存。下次灵感来临，随时找得到。';
    $('empty-actions').hidden=false;
  } else {
    $('empty-title').textContent=view==='trash'&&!category&&!tag&&!$('search-input').value?'回收站还是空的':view==='favorites'&&!category&&!tag&&!$('search-input').value?'把值得再看的灵感点亮':'没有找到匹配的提示词';
    $('empty-description').textContent=view==='trash'?'移入回收站的记录可随时恢复，参考图也会一起保留。':view==='favorites'?'点击卡片上的星标，即可在这里快速找到。':'试试更短的关键词，或清除分类与标签筛选。';
    $('empty-actions').hidden=true;
  }
}
function card(r,index) {
  const isTrash=!!r.deletedAt;
  const cover=r.images.length?'<img src="'+esc(r.images[0].dataUrl)+'" alt="'+esc(r.images[0].name)+'" loading="lazy"><span class="image-count">⊞ '+r.images.length+' 张参考图</span>':'<div class="cover-typography tone-'+(index%3)+'"><span class="cover-index">PROMPT / '+String(index+1).padStart(2,'0')+'</span><span class="cover-word">'+esc(r.category||'一帧灵感')+'</span><span class="cover-orbit" aria-hidden="true">✳</span></div>';
  return '<article class="record-card" data-id="'+esc(r.id)+'" data-testid="record-card"><button class="card-cover" data-action="detail" aria-label="查看 '+esc(r.title)+'">'+cover+'</button><div class="card-content"><div class="card-eyebrow"><span class="card-category">'+esc(r.category||'未分类')+'</span><span class="rating">'+(r.rating?'★ '+r.rating+'.0':'未评分')+'</span></div><button class="card-title" data-action="detail">'+esc(r.title)+'</button><p class="card-excerpt">'+esc(r.prompt)+'</p><div class="card-tags">'+r.tags.slice(0,4).map(t=>'<button class="tag" data-tag="'+esc(t)+'"># '+esc(t)+'</button>').join('')+'</div><div class="card-meta"><span>'+esc(r.model||'版本未记录')+'</span><span>'+date(r.updatedAt)+' 更新</span></div><div class="card-actions">'+(isTrash?'<button class="card-copy" data-action="restore">↶ 恢复记录</button><span class="trash-note">可随时恢复</span>':'<button class="card-copy" data-action="copy">⧉ 复制原文</button><div><button class="icon-btn card-star '+(r.favorite?'selected':'')+'" data-action="favorite" aria-label="'+(r.favorite?'取消收藏':'收藏')+' '+esc(r.title)+'" aria-pressed="'+r.favorite+'">'+(r.favorite?'★':'☆')+'</button><button class="icon-btn card-edit" data-action="edit" aria-label="编辑 '+esc(r.title)+'">✎</button><button class="icon-btn card-delete" data-action="delete" aria-label="移入回收站 '+esc(r.title)+'">♧</button></div>')+'</div></div></article>';
}
function openEditor(record, template) {
  editing=record||null;
  $('record-form').reset();
  fields.forEach(field=>$('edit-'+field).value=record?record[field]:(field==='rating'?'0':''));
  $('edit-tags').value=record?record.tags.join(', '):'';
  $('edit-favorite').checked=record?record.favorite:false;
  draftImages=record?record.images.map(image=>({...image})):[];
  if(template) $('edit-prompt').value=$('template-dialog').querySelector('pre').textContent;
  $('editor-title').textContent=record?'编辑提示词':template?'从模板开始记录':'新增提示词';
  $('form-error').hidden=true;
  $('image-input').value='';
  updatePromptLength(); renderImages();
  closeAll(); openDialog('editor-dialog');
}
function updatePromptLength() { $('prompt-length').textContent=$('edit-prompt').value.length.toLocaleString('zh-CN')+' 字'; }
function renderImages() {
  $('image-preview').innerHTML=draftImages.map((img,i)=>'<div class="image-item"><img src="'+esc(img.dataUrl)+'" alt="'+esc(img.name)+'"><span>'+esc(img.name)+'</span><button type="button" data-remove-image="'+i+'" aria-label="移除参考图 '+esc(img.name)+'">×</button></div>').join('');
}
async function persist(record) {
  const saved=await Store.save(record);
  const index=records.findIndex(r=>r.id===saved.id);
  if(index>=0) records[index]=saved; else records.push(saved);
  render();
  return saved;
}
async function saveForm(event) {
  event.preventDefault(); if(saving||readingImages) return;
  $('form-error').hidden=true; saving=true; $('save-button').disabled=true; $('save-button').textContent='正在保存…';
  try {
    const input={};
    fields.forEach(field=>input[field]=$('edit-'+field).value);
    input.rating=Number(input.rating);input.tags=$('edit-tags').value.split(/[,，、\n]/).map(t=>t.trim()).filter(Boolean);
    if(input.tags.length>20) throw new Error('标签最多 20 个，请合并部分标签后保存。');
    input.favorite=$('edit-favorite').checked;input.images=draftImages;
    const record=Core.makeRecord(input,editing);
    await persist(record); $('editor-dialog').close(); clearError(); toast('已保存到当前浏览器');
  } catch(error) {
    $('form-error').textContent='未能保存：'+errorText(error)+' 你填写的内容仍保留在编辑器中。';
    $('form-error').hidden=false;
  } finally {saving=false;$('save-button').disabled=false;$('save-button').textContent='保存提示词';}
}
async function readImages(event) {
  const files=[...event.target.files]; if(!files.length) return;
  readingImages=true; $('save-button').disabled=true; $('form-error').hidden=true;
  try {
    if(draftImages.length+files.length>6) throw new Error('每条记录最多 6 张参考图。');
    const added=[];
    for(const file of files) {
      if(!Core.IMAGE_TYPES.includes(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片。');
      if(file.size>Core.MAX_IMAGE_BYTES) throw new Error('每张参考图不能超过 6 MB。');
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('读取图片失败'));reader.readAsDataURL(file);});
      await new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(new Error('图片无法解码，请选择有效图片。'));image.src=dataUrl;});
      added.push({id:Core.newId(),name:file.name,type:file.type,dataUrl});
    }
    draftImages.push(...added);renderImages();
  } catch(error) {$('form-error').textContent=errorText(error);$('form-error').hidden=false;}
  finally {readingImages=false;$('save-button').disabled=false;$('image-input').value='';}
}
function detailSection(label,text,copyAction) {
  return text?'<section class="detail-section"><div class="detail-label"><h3>'+label+'</h3>'+(copyAction?'<button class="text-btn" data-detail-copy="'+copyAction+'">复制</button>':'')+'</div><pre class="detail-text">'+esc(text)+'</pre></section>':'';
}
function showDetail(record) {
  detailId=record.id;$('detail-title').textContent=record.title;
  $('detail-body').innerHTML='<div class="detail-tags"><span class="card-category">'+esc(record.category||'未分类')+'</span>'+record.tags.map(t=>'<span class="tag"># '+esc(t)+'</span>').join('')+'<span class="rating">'+(record.rating?'★'.repeat(record.rating)+' · '+record.rating+' 分':'暂未评价')+'</span></div>'+
    (record.images.length?'<div class="detail-images">'+record.images.map(img=>'<figure><img src="'+esc(img.dataUrl)+'" alt="'+esc(img.name)+'"><figcaption>'+esc(img.name)+'</figcaption></figure>').join('')+'</div>':'')+
    detailSection('完整提示词',record.prompt,'prompt')+detailSection('负面提示词',record.negative,'negative')+
    '<div class="detail-meta-grid"><div class="detail-meta-item"><h3>模型版本</h3><p>'+esc(record.model||'未记录')+'</p></div><div class="detail-meta-item"><h3>生成参数 · 自由记录</h3><pre>'+esc(record.parameters||'未记录')+'</pre></div></div>'+
    detailSection('效果评价与复盘',record.review)+detailSection('来源',record.source)+
    (record.videoUrl?'<section class="detail-section"><h3>成片链接</h3><a class="external-link" href="'+esc(Core.safeUrl(record.videoUrl))+'" target="_blank" rel="noopener noreferrer">'+esc(record.videoUrl)+' ↗</a></section>':'')+
    '<p class="detail-dates">创建于 '+esc(new Date(record.createdAt).toLocaleString('zh-CN'))+' · 更新于 '+esc(new Date(record.updatedAt).toLocaleString('zh-CN'))+'</p>';
  $('detail-edit').hidden=!!record.deletedAt;
  openDialog('detail-dialog');
}
async function copyText(text) {
  let copied=false;
  try { if(navigator.clipboard&&window.isSecureContext) {await navigator.clipboard.writeText(text);copied=true;} } catch(_) {}
  if(!copied) {
    const parent=document.querySelector('dialog[open]')||document.body;
    const area=document.createElement('textarea');area.value=text;area.className='clipboard-helper';area.setAttribute('aria-hidden','true');parent.append(area);area.select();
    try {copied=document.execCommand('copy');}catch(_){} area.remove();
  }
  if(copied) toast('完整原文已复制');
  else {$('manual-copy').value=text;openDialog('copy-dialog');$('manual-copy').select();}
}
async function act(action,id) {
  const record=records.find(r=>r.id===id);if(!record)return;
  if(action==='detail'){showDetail(record);return;}
  if(action==='copy'){await copyText(record.prompt);return;}
  if(action==='edit'){openEditor(record);return;}
  try {
    if(action==='favorite'){await persist(Core.makeRecord({favorite:!record.favorite},record));toast(record.favorite?'已取消收藏':'已加入收藏');}
    if(action==='delete'){
      await persist(Core.makeRecord({deletedAt:new Date().toISOString()},record));
      toast('已移入回收站，可随时恢复',async()=>{await act('restore',record.id);});
    }
    if(action==='restore'){await persist(Core.makeRecord({deletedAt:null},record));toast('已恢复记录');}
    clearError();
  } catch(error) {showError(new Error('操作未保存：'+errorText(error)));}
}
const downloadUrls=[];
function cleanupDownloads(){downloadUrls.splice(0).forEach(url=>URL.revokeObjectURL(url));}
function downloadBackup(parts) {
  cleanupDownloads();
  const stamp=new Date().toISOString().slice(0,10);
  if(parts.length===1) {
    const blob=new Blob([JSON.stringify(parts[0])],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);downloadUrls.push(url);
    const link=document.createElement('a');link.href=url;link.download='灵感档案-'+stamp+'.json';document.body.append(link);link.click();link.remove();
    toast('备份已生成，请确认 JSON 文件已下载');
  } else {
    let dialog=$('export-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='export-dialog';dialog.className='help-dialog';dialog.innerHTML='<div class="dialog-header"><h2>分卷下载备份</h2><button class="close-btn" data-close aria-label="关闭备份下载">×</button></div><div class="help-body"><p>资料库较大，已分为多份 JSON。请逐一点击保存全部文件；恢复时逐一导入即可，现有记录会保留。</p><div id="export-parts"></div></div>';document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();}
    $('export-parts').innerHTML='';
    parts.forEach((part,i)=>{const link=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(part)],{type:'application/json;charset=utf-8'}));downloadUrls.push(url);link.href=url;link.download='灵感档案-'+stamp+'-'+(i+1)+'-of-'+parts.length+'.json';link.textContent='↓ 下载第 '+(i+1)+' / '+parts.length+' 卷（'+part.records.length+' 条）';link.className='export-part button secondary';$('export-parts').append(link);});
    openDialog('export-dialog');
  }
}
async function exportAll() {
  try {const fresh=await Store.all();const parts=Core.makeBackupParts?Core.makeBackupParts(fresh):[Core.makeBackup(fresh)];downloadBackup(parts);clearError();}
  catch(error){showError(new Error('未能生成备份：'+errorText(error)));}
}
async function selectImport(event) {
  if(importing) return;
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try {
    if(file.size>Core.MAX_BACKUP_BYTES)throw new Error('单个备份文件不能超过 60 MB。请按导出的分卷逐一导入。');
    const parsed=JSON.parse(await file.text());pendingImport=Core.validateBackup(parsed);
    const preview=Core.prepareImport(await Store.all(),pendingImport);
    $('import-summary').textContent='已验证 '+pendingImport.length+' 条记录。预计新增 '+preview.added+' 条，跳过 '+preview.skipped+' 条重复记录，其中 '+preview.conflicts+' 条编号冲突会作为新记录保留。';
    $('import-error').hidden=true;openDialog('import-dialog');clearError();
  }catch(error){pendingImport=null;showError(new Error('未导入任何数据：'+errorText(error)));}
}
async function confirmImport() {
  if(!pendingImport||importing)return;
  importing=true;
  const button=$('confirm-import');button.disabled=true;button.textContent='正在合并…';
  try {
    const result=await Store.importRecords(pendingImport);
    pendingImport=null;
    $('import-dialog').close();clearError();
    try {records=await Store.all();render();}
    catch(error) {showError(new Error('数据已成功导入，但列表刷新失败。请刷新页面查看，勿重复导入：'+errorText(error)));}
    toast('导入完成：新增 '+result.added+' 条，跳过 '+result.skipped+' 条重复记录');
  }catch(error){$('import-error').textContent='导入未完成：'+errorText(error);$('import-error').hidden=false;}
  finally {importing=false;button.disabled=false;button.textContent='确认合并导入';}
}
$('record-form').addEventListener('submit',saveForm);
$('image-input').addEventListener('change',readImages);
$('edit-prompt').addEventListener('input',updatePromptLength);
['new-button','empty-new'].forEach(id=>$(id).onclick=()=>openEditor());
['help-button','sidebar-help'].forEach(id=>$(id).onclick=()=>openDialog('help-dialog'));
document.querySelectorAll('.template-trigger').forEach(el=>el.onclick=()=>openDialog('template-dialog'));
$('use-template').onclick=()=>openEditor(null,true);
document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>{if(!saving&&!readingImages&&!importing)el.closest('dialog').close();});
$('editor-dialog').addEventListener('cancel',event=>{if(saving||readingImages)event.preventDefault();});
$('import-dialog').addEventListener('cancel',event=>{if(importing)event.preventDefault();});
$('search-input').addEventListener('input',render);
$('category-filter').addEventListener('change',event=>{category=event.target.value;render();});
$('sort-select').addEventListener('change',render);
document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{view=el.dataset.view;resetFilters();render();});
$('image-preview').onclick=event=>{const button=event.target.closest('[data-remove-image]');if(button){draftImages.splice(Number(button.dataset.removeImage),1);renderImages();}};
document.addEventListener('click',event=>{
  const filter=event.target.closest('[data-category],[data-tag],#clear-filters');
  if(filter){
    if(filter.id==='clear-filters') resetFilters();
    else if(filter.hasAttribute('data-tag')) tag=tag===filter.dataset.tag?'':filter.dataset.tag;
    else {category=category===filter.dataset.category?'':filter.dataset.category;if(view==='trash')view='all';}
    render();return;
  }
  const action=event.target.closest('[data-action]');
  if(action){const card=action.closest('[data-id]');if(card)act(action.dataset.action,card.dataset.id);}
});
$('detail-edit').onclick=()=>openEditor(records.find(r=>r.id===detailId));
$('detail-copy').onclick=()=>{const record=records.find(r=>r.id===detailId);if(record)copyText(record.prompt);};
$('detail-body').onclick=event=>{const button=event.target.closest('[data-detail-copy]');const record=records.find(r=>r.id===detailId);if(button&&record)copyText(record[button.dataset.detailCopy]);};
$('export-button').onclick=exportAll;
$('import-button').onclick=()=>$('import-file').click();
$('import-file').addEventListener('change',selectImport);
$('confirm-import').onclick=confirmImport;
$('toast-dismiss').onclick=()=>{$('toast').hidden=true;};
$('toast-action').onclick=async()=>{const callback=toastCallback;toastCallback=null;$('toast').hidden=true;if(callback)await callback();};
document.addEventListener('keydown',event=>{
  if(event.key==='/'&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('search-input').focus();}
});
window.addEventListener('focus',async()=>{if(!document.querySelector('dialog[open]')){try{records=await Store.all();render();}catch(error){showError(error);}}});
(async()=>{
  try {await Store.open();records=await Store.all();$('storage-state').textContent='本地资料库已就绪';render();document.body.dataset.testid='app-ready';}
  catch(error){$('storage-state').textContent='本地存储不可用';showError(new Error('资料库无法打开，当前无法保存：'+errorText(error)));render();}
})();
})();
