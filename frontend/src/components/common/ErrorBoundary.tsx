import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React ErrorBoundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          background: '#0f172a',
          color: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #ef4444',
          margin: '16px',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <span style={{ fontSize: '24px' }}>⚠️</span>
            <h3 style={{ margin: 0, color: '#f87171', fontSize: '16px', fontWeight: 700 }}>
              {this.props.fallbackTitle || 'Đã xảy ra lỗi giao diện không mong muốn'}
            </h3>
          </div>
          <p style={{ color: '#cbd5e1', fontSize: '13px', marginBottom: '12px', lineHeight: 1.5 }}>
            Ứng dụng đã bắt được lỗi an toàn và ngăn màn hình bị đen. Bạn có thể nhấn nút bên dưới để khôi phục hoặc xem chi tiết lỗi:
          </p>
          <div style={{
            background: '#020617',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid #334155',
            fontFamily: 'Consolas, monospace',
            fontSize: '12px',
            color: '#ef4444',
            overflowX: 'auto',
            marginBottom: '16px',
            maxHeight: '180px'
          }}>
            {this.state.error?.toString()}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 16px',
                background: '#38bdf8',
                color: '#0f172a',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              🔄 Thử tải lại giao diện
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                color: '#94a3b8',
                border: '1px solid #475569',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              Làm mới toàn bộ ứng dụng (F5)
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
