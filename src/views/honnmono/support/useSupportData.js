import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../../lib/supportApi.js';
import { mergeMessages, SUPPORT_PAGE_SIZE } from '../../../lib/supportConfig.js';

export function useSupportList(options, filters) {
  const params = { status: filters.state === 'closed' ? 'closed' : 'open',
    filter: filters.state === 'waiting' ? 'waiting_staff' : undefined, q: filters.search, size: SUPPORT_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: ['support', options.operatorEmail, 'list', params], initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => api.listConversations({ ...params, page: pageParam }, { ...options, signal }),
    getNextPageParam: (last, pages) => last.length === SUPPORT_PAGE_SIZE ? pages.length + 1 : undefined,
    refetchInterval: 10000, staleTime: 0, gcTime: 0,
  });
}

export function useSupportThread(id, options) {
  const client = useQueryClient();
  const prefix = ['support', options.operatorEmail];
  const detailKey = [...prefix, 'detail', id], messageKey = [...prefix, 'messages', id];
  const [outbox, setOutbox] = useState([]);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState(null);
  const [hasOlder, setHasOlder] = useState(false);
  const unread = useRef(new Map()), activeId = useRef(id), draftUrls = useRef(new Set());
  activeId.current = id;
  useEffect(() => () => draftUrls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const detail = useQuery({
    queryKey: detailKey, enabled: !!id, gcTime: 0, staleTime: 0, refetchInterval: 3000,
    queryFn: async ({ signal }) => {
      const conversation = await api.getConversation(id, { ...options, signal });
      if (!unread.current.has(id)) unread.current.set(id, conversation.staffReadMsgId);
      return conversation;
    },
  });
  const thread = useQuery({
    queryKey: messageKey, enabled: !!id && !!detail.data, gcTime: 0, staleTime: 0, refetchInterval: 3000,
    queryFn: async ({ signal }) => {
      const current = client.getQueryData(messageKey) || [];
      let afterId = Math.max(0, ...current.map(message => message.id)), incoming = [], batch;
      do {
        batch = await api.listMessages(id, { afterId, limit: SUPPORT_PAGE_SIZE }, { ...options, signal });
        incoming = mergeMessages(incoming, batch);
        if (!afterId) {
          if (activeId.current === id) setHasOlder(batch.length === SUPPORT_PAGE_SIZE);
          break;
        }
        if (batch.length) afterId = batch.at(-1).id;
      } while (batch.length === SUPPORT_PAGE_SIZE);
      return mergeMessages(client.getQueryData(messageKey) || [], incoming);
    },
  });
  useEffect(() => {
    setOlderError(null); setOlderBusy(false); setHasOlder(false); unread.current.delete(id);
  }, [id]);
  const confirmed = thread.data || [];
  const visibleOutbox = outbox.filter(item => item.conversationId === id
    && !confirmed.some(message => message.clientMsgId === item.clientMsgId));
  async function transmit(entry) {
    setOutbox(current => current.map(item => item.clientMsgId === entry.clientMsgId ? { ...item, state: 'sending' } : item));
    try {
      // Retain completed uploads on the draft so a retry reuses their cfids.
      for (let index = entry.attachments.length; index < entry.files.length; index++) {
        entry.attachments.push(await api.uploadAttachment(entry.conversationId, entry.files[index], {
          ...options, limits: detail.data?.limits,
        }));
      }
      const saved = await api.sendMessage(entry.conversationId, {
        clientMsgId: entry.clientMsgId, msgType: entry.msgType, content: entry.content, attachments: entry.attachments,
      }, options);
      client.setQueryData([...prefix, 'messages', entry.conversationId], current => mergeMessages(current, [saved]));
      setOutbox(current => current.filter(item => item.clientMsgId !== entry.clientMsgId));
      entry.previewUrls.forEach(url => { URL.revokeObjectURL(url); draftUrls.current.delete(url); });
      client.invalidateQueries({ queryKey: prefix });
    } catch (error) {
      setOutbox(current => current.map(item => item.clientMsgId === entry.clientMsgId ? { ...entry, state: 'failed', error } : item));
    }
  }
  function send({ content, files }) {
    const groups = [];
    const images = files.filter(file => file.type.startsWith('image/'));
    const other = files.filter(file => !file.type.startsWith('image/'));
    if (images.length) groups.push({ msgType: 'image', files: images });
    other.forEach(file => groups.push({ msgType: 'file', files: [file] }));
    if (!groups.length) groups.push({ msgType: 'text', files: [] });
    groups.forEach((group, index) => {
      const entry = { ...group, conversationId: id, clientMsgId: crypto.randomUUID(),
        id: `draft-${crypto.randomUUID()}`, content: index ? '' : content, attachments: [],
        senderRole: 'staff', senderName: options.operatorEmail, createdAt: Date.now(), state: 'sending',
        previewUrls: group.files.map(file => { const url = URL.createObjectURL(file); draftUrls.current.add(url); return url; }) };
      setOutbox(current => [...current, entry]);
      void transmit(entry);
    });
  }
  async function loadOlder() {
    if (olderBusy || !hasOlder) return;
    setOlderBusy(true); setOlderError(null);
    try {
      const older = await api.listMessages(id, { beforeId: confirmed[0]?.id, limit: SUPPORT_PAGE_SIZE }, options);
      client.setQueryData(messageKey, current => mergeMessages(older, current));
      if (activeId.current === id) setHasOlder(older.length === SUPPORT_PAGE_SIZE);
      return older.length;
    } catch (error) { if (activeId.current === id) setOlderError(error); }
    finally { if (activeId.current === id) setOlderBusy(false); }
  }
  async function change(body) {
    const saved = body === 'close' ? await api.closeConversation(id, options) : await api.updateConversation(id, body, options);
    client.setQueryData(detailKey, saved);
    await client.invalidateQueries({ queryKey: prefix });
  }
  return { detail, thread, messages: mergeMessages(confirmed, visibleOutbox), send, retry: transmit,
    hasOlder, olderBusy, olderError, loadOlder, change, unreadId: unread.current.get(id) };
}
