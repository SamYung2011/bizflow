import { useEffect } from 'react';
import { useT } from '../../i18n.jsx';
import { PROMPT_LEAVE_EVENT } from '../../../root-site/bizflow/app-prompt-leave.js';

export function usePromptLeave(editorRef, providerRef) {
  const { t } = useT();
  useEffect(() => {
    const guards = () => [editorRef.current, providerRef.current].filter(Boolean);
    const leaving = event => {
      const current = guards();
      if (current.some(guard => guard.busy)) { event.preventDefault(); return; }
      if (!current.some(guard => guard.dirty)) return;
      if (!window.confirm(t('有未儲存修改，放棄並離開？'))) event.preventDefault();
      else current.filter(guard => guard.dirty).forEach(guard => guard.discard());
    };
    const unloading = event => {
      if (guards().some(guard => guard.dirty || guard.busy)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener(PROMPT_LEAVE_EVENT, leaving);
    window.addEventListener('beforeunload', unloading);
    return () => { window.removeEventListener(PROMPT_LEAVE_EVENT, leaving); window.removeEventListener('beforeunload', unloading); };
  }, [editorRef, providerRef, t]);
}
