'use client';

/**
 * Settings.
 *
 * Not capability-gated as a whole: everyone has a profile. The officer-only
 * part is the invite form inside the Members section, which gates itself on
 * `member:invite`.
 */

import {SettingsView} from '../../../components/settings/settings-view';

export default function SettingsPage() {
  return <SettingsView />;
}
