/** Knowledge keeps its own type while sharing the non-idiom layout slot. */
export const contentSlot=c=>c.content_kind==='knowledge'?'news':c.content_kind??'news';
export const selectionEventKey=c=>c.content_kind==='knowledge'?'knowledge:'+c.word:c.event_id;
