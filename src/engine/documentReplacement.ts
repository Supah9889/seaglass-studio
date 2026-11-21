/** Identifies one New / Open project / Open image request and the state the user agreed to replace. */
export type ReplacementTicket<D>={request:number;document:D|null;revision:number};

export type ReplacementCheck='commit'|'superseded'|'changed';

export const REPLACEMENT_CHANGED_MESSAGE='Artwork changed while the file was opening; your current document was kept. Open the file again to replace it.';

/**
 * Orders document replacement requests. A request may commit only while it is the newest
 * request and the document and revision it was approved against are still current.
 */
export class ReplacementGuard<D>{
 private latest=0;

 begin(document:D|null,revision:number):ReplacementTicket<D>{
  return {request:++this.latest,document,revision};
 }

 check(ticket:ReplacementTicket<D>,document:D|null,revision:number,editInProgress=false):ReplacementCheck{
  if(ticket.request!==this.latest)return 'superseded';
  if(ticket.document!==document||ticket.revision!==revision||editInProgress)return 'changed';
  return 'commit';
 }
}
