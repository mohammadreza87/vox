'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { api, haptic, type AgentView } from '../../../_lib/client';
import { SPRING } from '../../../_lib/motion';
import { spawnCopy } from '../../../_lib/spawn-copy';
import { useNav } from '../../StudioApp';
import { AgentFace } from '../../Cloud';
import { Bubble, Composer, Icon, Sheet, SheetHead, Typing } from '../../ui';

type Message = { role: 'user' | 'assistant'; content: string; failed?: boolean };

/**
 * "Say hi" (D15): a sandbox chat with the draft, as a sheet over Draft or Hire. Same persona,
 * nothing becomes a memory. A failed send turns its bubble red and keeps the text with Retry.
 */
export function SayHiSheet({ agent, open, onClose }: { agent: AgentView; open: boolean; onClose: () => void }) {
  const c = spawnCopy[useNav().locale ?? 'en'].sayHi;
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const name = agent.persona.name;
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [messages, thinking]);

  const send = async (history: Message[]) => {
    setMessages(history);
    setThinking(true);
    try {
      const r = await api.test(agent.id, history.map(({ role, content }) => ({ role, content })));
      setMessages([...history, { role: 'assistant', content: r.reply }]);
    } catch {
      haptic.error();
      setMessages(history.map((m, i) => (i === history.length - 1 ? { ...m, failed: true } : m)));
    } finally {
      setThinking(false);
    }
  };
  const submit = (content = text.trim()) => {
    if (!content || thinking) return;
    setText('');
    void send([...messages.filter((m) => !m.failed), { role: 'user', content }]);
  };
  const retry = () => {
    const last = messages[messages.length - 1];
    if (last?.failed) void send([...messages.slice(0, -1), { role: 'user', content: last.content }]);
  };

  return (
    <Sheet open={open} onClose={onClose} label={c.title(name)}
      dock={<Composer value={text} onChange={setText} onSend={() => submit()} busy={thinking} placeholder={c.placeholder(name)} label={c.message} sendLabel={c.send} maxLength={2000} />}>
      <div className="vx-sheet-lead">
        <AgentFace look={agent.look} size={48} stage={agent.stage} expr={thinking ? 'thinking' : 'idle'} preferCloud label={name} />
        <SheetHead title={c.title(name)} sub={c.sandbox} />
      </div>
      <div className="vx-thread vx-sayhi" role="log" aria-label={c.chatWith(name)}>
        {messages.length === 0 && (
          <div className="vx-chip-wrap">
            {c.starters.map((s) => <button key={s} type="button" className="vx-chip" onClick={() => submit(s)}>{s}</button>)}
          </div>
        )}
        {messages.map((m, i) => (
          <motion.div key={i} className={`vx-bubble-row ${m.role === 'user' ? 'me' : 'agent'}`}
            initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING.snappy}>
            <Bubble from={m.role === 'user' ? 'me' : 'agent'} failed={m.failed}>{m.content}</Bubble>
            {m.failed && (
              <button type="button" className="vx-bubble-meta me vx-link-btn danger" onClick={retry}>
                <Icon name="refresh" size={12} />{c.notSent}
              </button>
            )}
          </motion.div>
        ))}
        {thinking && <Typing label={c.typing(name)} />}
        <div ref={end} />
      </div>
    </Sheet>
  );
}
