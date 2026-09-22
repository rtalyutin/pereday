// Native Figma construction helpers; source for review, not part of the app bundle.
const createdNodeIds=[];
await Promise.all(['Regular','Semi Bold','Extra Bold'].map(style=>figma.loadFontAsync({family:'Inter',style})));
const allVars=await figma.variables.getLocalVariablesAsync();
const V=Object.fromEntries(allVars.filter(v=>v.name.startsWith('color/')).map(v=>[v.name.slice(6),v]));
const S=Object.fromEntries((await figma.getLocalTextStylesAsync()).filter(s=>s.name.startsWith('Peredai/')).map(s=>[s.name.slice(8),s]));
function keep(n){createdNodeIds.push(n.id);return n;}
function paint(k){return figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',V[k]);}
function text(parent,content,style='Body',width,color='ink'){
 const n=keep(figma.createText());n.name=content.slice(0,40);n.fontName=S[style].fontName;n.fontSize=S[style].fontSize;n.lineHeight=S[style].lineHeight;n.letterSpacing=S[style].letterSpacing;n.textStyleId=S[style].id;n.characters=content;n.fills=[paint(color)];parent.appendChild(n);
 if(width){n.textAutoResize='HEIGHT';n.resize(width,n.height);}return n;
}
function stack(parent,name,width,gap=16,direction='VERTICAL',fill){
 const n=keep(figma.createAutoLayout(direction));n.name=name;n.resize(width,100);n.layoutSizingHorizontal='FIXED';n.layoutSizingVertical='HUG';n.itemSpacing=gap;n.fills=fill?[paint(fill)]:[];parent.appendChild(n);return n;
}
function rectangle(parent,name,w,h,color){const n=keep(figma.createRectangle());n.name=name;n.resize(w,h);n.fills=[paint(color)];parent.appendChild(n);return n;}
function artwork(parent,name,hash,w,h){const n=keep(figma.createRectangle());n.name=name;n.resize(w,h);n.fills=[{type:'IMAGE',imageHash:hash,scaleMode:'FIT'}];parent.appendChild(n);return n;}
function border(n,color='line',radius=12){n.strokes=[paint(color)];n.strokeWeight=1;n.cornerRadius=radius;}
function pad(n,p){n.paddingTop=p;n.paddingBottom=p;n.paddingLeft=p;n.paddingRight=p;}
