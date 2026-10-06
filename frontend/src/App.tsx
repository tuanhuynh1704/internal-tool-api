import React from 'react';
import { AppProvider } from './context/AppContext';
import MainLayout from './layouts/MainLayout';
import ErrorBoundary from './components/common/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="Đã xảy ra sự cố giao diện">
      <AppProvider>
        <MainLayout />
      </AppProvider>
    </ErrorBoundary>
  );
}

// import RequestPanel from './components/RequestPanel/RequestPanel';
// import ResponsePanel from './components/ResponsePanel/ResponsePanel';
// import { SidebarProject } from './components/SidebarProject';
// import TabHeaderBar from './components/TabHeaderBar';
// import { useApp } from './context/AppContext';

// function App() {
//     const { activeTabId } = useApp();

//     return (
//         <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
//             {/* Cột 1: Cố định Sidebar quản lý dự án bên trái */}
//             <div style={{ width: '300px', borderRight: '1px solid #333', background: '#1e1e1e' }}>
//                 <SidebarProject />
//             </div>

//             {/* Vùng thao tác chính bên phải */}
//             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#121212', color: '#fff' }}>
//                 {/* Luôn hiển thị thanh quản lý tab request */}
//                 <TabHeaderBar />

//                 {activeTabId ? (
//                     <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
//                         {/* Cột 2 (Phía trên): Khu vực nhập URL, Method, Headers, Body */}
//                         <div style={{ padding: '16px', borderBottom: '1px solid #333' }}>
//                             <RequestPanel />
//                         </div>
                        
//                         {/* Cột 3 (Phía dưới): Khu vực nhận Response kết quả */}
//                         <div style={{ flex: 1, padding: '16px', background: '#151515' }}>
//                             <ResponsePanel />
//                         </div>
//                     </div>
//                 ) : (
//                     <div style={{ margin: 'auto', color: '#666' }}>Chọn một phiên làm việc từ cây thư mục để bắt đầu</div>
//                 )}
//             </div>
//         </div>
//     );
// }