import { useEffect } from 'react';
import { useT } from '../../i18n.jsx';
import { PROMPT_LEAVE_EVENT } from '../../../root-site/bizflow/app-prompt-leave.js';

export function usePromptLeave(dirty, busy, discard) {
  const { t } = useT();
  useEffect(() => {
    if (!dirty && !busy) return;
    const leaving = event => {
      if (busy) { event.preventDefault(); return; }
      if (!window.confirm(t('有未儲存修改，放棄並離開？'))) event.preventDefault();
      else discard();
    };
    const unloading = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener(PROMPT_LEAVE_EVENT, leaving);
    window.addEventListener('beforeunload', unloading);
    return () => { window.removeEventListener(PROMPT_LEAVE_EVENT, leaving); window.removeEventListener('beforeunload', unloading); };
  }, [dirty, busy, discard, t]);
}
