export const CALENDAR_WEEKDAYS=['일','월','화','수','목','금','토'];

export function monthCells(month:string):string[] {
 if(!month)return [];
 const start=new Date(month+'-01T12:00:00Z');
 const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0,12));
 start.setUTCDate(start.getUTCDate()-start.getUTCDay());
 end.setUTCDate(end.getUTCDate()+6-end.getUTCDay());
 const days:string[]=[];
 for(;start<=end;start.setUTCDate(start.getUTCDate()+1))days.push(start.toISOString().slice(0,10));
 return days;
}
export function shiftMonth(month:string,delta:number):string {
 const date=new Date(month+'-01T12:00:00Z');
 date.setUTCMonth(date.getUTCMonth()+delta);
 return date.toISOString().slice(0,7);
}
export function isCalendarWeekend(date:string):boolean {
 const day=new Date(date+'T12:00:00Z').getUTCDay();
 return day===0||day===6;
}
