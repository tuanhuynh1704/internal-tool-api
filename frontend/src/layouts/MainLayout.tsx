import React, { useCallback, useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar/Sidebar';
import Workspace from '../pages/Workspace/Workspace';
import UpdateModal, { UpdateInfo, UpdatePhase } from '../components/UpdateModal/UpdateModal';
import UITestModal from '../components/UITestModal/UITestModal';
import UserGuideModal from '../components/UserGuideModal/UserGuideModal';

// Wails-generated bindings
import {
  CheckForUpdate,
  StartDownloadUpdate,
  ApplyUpdate,
} from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UpdateStatus {
  phase: 'idle' | 'downloading' | 'done' | 'error';
  percent: number;
  errorMsg?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MainLayout() {
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [isAutomationModalOpen, setIsAutomationModalOpen] = useState(false);
  const [isUITestModalOpen, setIsUITestModalOpen] = useState(false);
  const [isUserGuideOpen, setIsUserGuideOpen] = useState(false);

  // ── Update state ──────────────────────────────────────────────────────────
  const [updateInfo, setUpdateInfo]         = useState<UpdateInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updatePhase, setUpdatePhase]       = useState<UpdatePhase>('available');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError]       = useState<string | undefined>(undefined);

  // ── Kiểm tra update lúc khởi động (delay 3s cho app load xong) ────────────
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const info = await CheckForUpdate();
        if (info) {
          setUpdateInfo(info as UpdateInfo);
          setUpdatePhase('available');
          setShowUpdateModal(true);
        }
      } catch (err) {
        // Không fatal — app tiếp tục hoạt động bình thường
        console.warn('[updater] update check failed (non-fatal):', err);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // ── Nhận progress events từ Go backend ───────────────────────────────────
  useEffect(() => {
    const handler = (status: UpdateStatus) => {
      switch (status.phase) {
        case 'downloading':
          setUpdatePhase('downloading');
          setDownloadPercent(status.percent);
          break;
        case 'done':
          setUpdatePhase('done');
          setDownloadPercent(100);
          break;
        case 'error':
          setUpdatePhase('error');
          setUpdateError(status.errorMsg ?? 'Unknown error');
          break;
      }
    };

    EventsOn('updater:status', handler);
    return () => { EventsOff('updater:status'); };
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleUpdateNow = useCallback(async () => {
    if (!updateInfo) return;

    if (updatePhase === 'available' || updatePhase === 'error') {
      setUpdatePhase('downloading');
      setDownloadPercent(0);
      setUpdateError(undefined);
      try {
        await StartDownloadUpdate(updateInfo.Version, updateInfo.URL, updateInfo.SHA256);
      } catch (err: any) {
        setUpdatePhase('error');
        setUpdateError(err?.message ?? String(err));
      }
      return;
    }

    if (updatePhase === 'done') {
      setUpdatePhase('applying');
      try {
        await ApplyUpdate();
      } catch (err: any) {
        setUpdatePhase('error');
        setUpdateError(err?.message ?? String(err));
      }
    }
  }, [updateInfo, updatePhase]);

  const handleLater = useCallback(() => {
    if (updatePhase !== 'downloading' && updatePhase !== 'applying') {
      setShowUpdateModal(false);
    }
  }, [updatePhase]);

  const handleClose = useCallback(() => {
    setShowUpdateModal(false);
    setUpdatePhase('available');
    setUpdateError(undefined);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      backgroundColor: 'var(--bg-app)',
      color: 'var(--text-main)',
      fontFamily: 'var(--font-sans)'
    }}>
      {/* Sidebar cố định bên trái (280px) */}
      <div style={{
        width: '280px',
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <Sidebar
          onOpenEnvModal={() => setIsEnvModalOpen(true)}
          onOpenAutomationModal={() => setIsAutomationModalOpen(true)}
          onOpenUITestModal={() => setIsUITestModalOpen(true)}
          onOpenUserGuide={() => setIsUserGuideOpen(true)}
        />
      </div>

      {/* Vùng làm việc chính bên phải */}
      <div style={{
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <Workspace
          isEnvModalOpen={isEnvModalOpen}
          setIsEnvModalOpen={setIsEnvModalOpen}
          isAutomationModalOpen={isAutomationModalOpen}
          setIsAutomationModalOpen={setIsAutomationModalOpen}
          isUITestModalOpen={isUITestModalOpen}
          setIsUITestModalOpen={setIsUITestModalOpen}
          isUserGuideOpen={isUserGuideOpen}
          setIsUserGuideOpen={setIsUserGuideOpen}
        />
      </div>

      {/* UI Automation Testing Modal */}
      <UITestModal
        isOpen={isUITestModalOpen}
        onClose={() => setIsUITestModalOpen(false)}
      />

      {/* User Guide & Documentation Modal */}
      <UserGuideModal
        isOpen={isUserGuideOpen}
        onClose={() => setIsUserGuideOpen(false)}
      />

      {/* Update Modal — hiển thị khi có bản mới */}
      {showUpdateModal && updateInfo && (
        <UpdateModal
          updateInfo={updateInfo}
          phase={updatePhase}
          percent={downloadPercent}
          errorMsg={updateError}
          onUpdateNow={handleUpdateNow}
          onLater={handleLater}
          onClose={handleClose}
        />
      )}
    </div>
  );
}