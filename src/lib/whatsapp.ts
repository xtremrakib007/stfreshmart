export interface Line{name:string;unit:string;qty:number}
export function buildMessage(o:{customer:string;phone:string;company:string;method:string;address:string;when:string;lines:Line[];total:number;currency:string;notes:string;urgent?:string}){
  const items=o.lines.map(l=>`${l.name} x ${l.qty} ${l.unit}`).join('\n');
  return [o.method==='URGENT DELIVERY'?'*URGENT ORDER*\n':'','NEW ORDER REQUEST','',`Customer:\n${o.customer}`,`Phone:\n${o.phone}`,o.company&&`Company:\n${o.company}`,
    `Delivery Method:\n${o.method}`,o.address&&`Address:\n${o.address}`,o.when&&`When:\n${o.when}`,o.urgent&&`Urgent Reason:\n${o.urgent}`,`Items:\n${items}`,
    `Estimated Total:\n${o.currency}${o.total.toFixed(2)}`,o.notes&&`Instructions:\n${o.notes}`].filter(Boolean).join('\n\n');
}
export const waLink=(num:string,msg:string)=>`https://wa.me/${num.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
