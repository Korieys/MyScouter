'use client';
import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { loadPrivateDownload, savePrivateDownload } from './private-download';

export function usePrivateDownload(user: User | null, scoutId: string, isCurrentUser: () => boolean) {
    const scope = `${user?.uid || ''}:${scoutId}`;
    const [state,setState] = useState({scope:'',busy:'',error:''});
    const pending = useRef<AbortController | null>(null);
    useEffect(() => () => {pending.current?.abort(); pending.current=null;},[scope]);

    const download = async (filename?: string) => {
        if (!user || pending.current || !isCurrentUser()) return;
        const controller = new AbortController(); pending.current=controller;
        setState({scope,busy:filename || 'zip',error:''});
        try {
            const blob = await loadPrivateDownload(user,scoutId,filename,controller.signal);
            if (controller.signal.aborted || !isCurrentUser()) return;
            savePrivateDownload(blob,filename || `myscouter-${scoutId}.zip`);
        } catch (reason) {
            if (!controller.signal.aborted) setState({scope,busy:'',error:reason instanceof Error ? reason.message : 'Download failed. Please retry.'});
        } finally {
            if (pending.current === controller) {
                pending.current=null;
                if (!controller.signal.aborted) setState(previous => ({...previous,busy:''}));
            }
        }
    };
    return {download,downloading:state.scope === scope ? state.busy : '',downloadError:state.scope === scope ? state.error : ''};
}
