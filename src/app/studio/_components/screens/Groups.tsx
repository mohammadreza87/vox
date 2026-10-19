'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, type GroupItem } from '../../_lib/client';
import { Cloud } from '../Cloud';
import { errorMessage, useNav } from '../StudioApp';
import { Empty, Icon } from '../ui';

export function GroupsScreen() {
  const nav = useNav();
  const [groups, setGroups] = useState<GroupItem[] | null>(null);

  useEffect(() => {
    api.groups().then((r) => setGroups(r.groups)).catch((e) => nav.toast(errorMessage(e), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="vx-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <span className="vx-over">Telegram groups</span>
        <h1 className="vx-display">Groups</h1>
        <p className="vx-2" style={{ margin: 0 }}>Add an agent from its page (Group button). In a group, agents only use memories made in that group.</p>
      </div>
      {groups === null ? (
        [0, 1, 2].map((i) => <div key={i} className="vx-skeleton" style={{ height: 84 }} />)
      ) : groups.length === 0 ? (
        <Empty title="No groups yet" body="Open an agent and tap Group to add them to a Telegram chat." />
      ) : groups.map((g, i) => (
        <motion.div key={g.chatId} className="vx-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
          style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 40, height: 40, borderRadius: 14, background: '#1E2228', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="groups" size={20} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="vx-head" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</div>
              <div className="vx-small vx-2 vx-num">{g.memberCount} people · {g.agents.length} agent{g.agents.length === 1 ? '' : 's'}</div>
            </div>
            {g.hasGuests && <span className="vx-pill warn">GUESTS</span>}
          </div>
          {g.agents.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {g.agents.map((a) => (
                <button key={a.id} className="vx-chip" onClick={() => nav.push({ name: 'agent', id: a.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingLeft: 4, height: 34 }}>
                  <Cloud look={a.look} size={26} label={a.name} />{a.name}
                </button>
              ))}
            </div>
          )}
          {g.hasGuests && <div className="vx-small vx-2">People outside {nav.me.org} are here, so agents keep everything else private.</div>}
        </motion.div>
      ))}
    </div>
  );
}
