import {describe,expect,it} from 'vitest';
import {ReplacementGuard} from './documentReplacement';

describe('document replacement guard',()=>{
 const doc={id:'current'},other={id:'other'};

 it('commits when nothing changed since approval',()=>{
  const guard=new ReplacementGuard<typeof doc>();
  const ticket=guard.begin(doc,4);
  expect(guard.check(ticket,doc,4)).toBe('commit');
 });

 it('keeps intervening edits by refusing a changed revision',()=>{
  const guard=new ReplacementGuard<typeof doc>();
  const ticket=guard.begin(doc,4);
  expect(guard.check(ticket,doc,5)).toBe('changed');
 });

 it('refuses when the open document was already replaced',()=>{
  const guard=new ReplacementGuard<typeof doc>();
  const ticket=guard.begin(doc,4);
  expect(guard.check(ticket,other,4)).toBe('changed');
 });

 it('refuses while an edit gesture or staged operation is open',()=>{
  const guard=new ReplacementGuard<typeof doc>();
  const ticket=guard.begin(doc,4);
  expect(guard.check(ticket,doc,4,true)).toBe('changed');
 });

 it('lets only the newest of overlapping requests commit',()=>{
  const guard=new ReplacementGuard<typeof doc>();
  const first=guard.begin(doc,4),second=guard.begin(doc,4);
  expect(guard.check(first,doc,4)).toBe('superseded');
  expect(guard.check(second,doc,4)).toBe('commit');
 });

 it('treats a synchronous replacement as superseding pending opens',()=>{
  const guard=new ReplacementGuard<typeof doc>();
  const pendingOpen=guard.begin(doc,4);
  guard.begin(doc,4); // New document committed immediately
  expect(guard.check(pendingOpen,other,0)).toBe('superseded');
 });
});
