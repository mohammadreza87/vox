'use client';

import { tg } from '../../../_lib/client';
import type { SettingsPage as Page } from '../../StudioApp';
import { useNav } from '../../StudioApp';
import { GuestRightsOperationsPanel } from '../../GuestRightsOperationsPanel';
import { LearningPanel } from '../../LearningPanel';
import { RightsOperationsPanel } from '../../RightsOperationsPanel';
import { VoiceRecognitionPanel } from '../../VoiceRecognitionPanel';
import { Empty } from '../../ui';
import { ConnectionsScreen } from '../Connections';
import { AgentSettingsScreen } from './AgentSettings';
import { ConnectionDetailPage } from './ConnectionDetail';
import { InboxPage, PreferencesPage, RemindersPage } from './ExperiencePages';
import { SettingsPage, SpaceBar } from './kit';

const TITLE: Record<Page, [string, string]> = {
  preferences: ['Preferences', 'ترجیح‌ها'], inbox: ['Inbox', 'صندوق اعلان'], reminders: ['Reminders', 'یادآورها'], diagnostics: ['Diagnostics', 'عیب‌یابی'],
  requests: ['Privacy requests', 'درخواست‌های حریم خصوصی'], connection: ['Connection', 'اتصال'], 'voice-recognition': ['Voice recognition', 'تشخیص صدا'],
  'agent-access': ['Agent access', 'دسترسی عامل‌ها'], 'agent-connections': ['Connectors & plugins', 'اتصال‌ها و افزونه‌ها'], agent: ['Settings', 'تنظیمات'],
};

/** One route for every settings page under You; pages are added here without touching StudioApp. */
export function SettingsRouter({ page, params }: { page: Page; params?: Record<string, string> }) {
  const nav = useNav();
  const fa = nav.locale === 'fa';
  const title = TITLE[page][fa ? 1 : 0];
  const operator = nav.me.member.role === 'owner' || nav.me.member.role === 'superadmin';
  switch (page) {
    case 'preferences': return <PreferencesPage />;
    case 'inbox': return <InboxPage />;
    case 'reminders': return <RemindersPage notificationId={params?.notificationId} />;
    case 'connection': return params?.connectionId ? <ConnectionDetailPage connectionId={params.connectionId} agentId={params.agentId} /> : <ConnectionsScreen onBack={nav.back} agentId={params?.agentId} />;
    // `agent-access` is the old name of `agent-connections` (it always opened connectors); old links keep working.
    case 'agent-access':
    case 'agent-connections': return <ConnectionsScreen onBack={nav.back} agentId={params?.agentId} view={params?.view === 'activity' ? 'activity' : undefined} />;
    case 'agent': return nav.me.features?.settingsV2 && params?.agentId
      ? <AgentSettingsScreen agentId={params.agentId} section={params.section} from={params.from} />
      : <SettingsPage title={title}><Empty title={fa ? 'تنظیمات هنوز اینجا در دسترس نیست.' : 'Settings aren’t available here yet.'} /></SettingsPage>;
    case 'voice-recognition': return <SettingsPage title={title}><VoiceRecognitionPanel key={nav.space} space={nav.space} locale={nav.locale} /></SettingsPage>;
    default: break;
  }
  if (!operator) {
    return <SettingsPage title={title}>
      <Empty title={fa ? 'فقط برای مدیران' : 'For admins only'} body={fa ? 'این صفحه برای مالک سازمان است.' : 'This page is for the organisation’s owner.'} />
    </SettingsPage>;
  }
  const session = tg()?.initData ?? '';
  return page === 'requests'
    ? <SettingsPage title={title} className="vx-diag-page">
      <RightsOperationsPanel locale={nav.locale} sessionKey={session} />
      <GuestRightsOperationsPanel locale={nav.locale} sessionKey={session} />
    </SettingsPage>
    : <SettingsPage title={title} className="vx-diag-page">
      <SpaceBar />
      <LearningPanel key={nav.space} space={nav.space} locale={nav.locale} showOperations />
    </SettingsPage>;
}
