import React from 'react';
import { AppProvider } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './context/I18nContext';
import { DialogProvider } from './components/common/Dialog';
import MainLayout from './layouts/MainLayout';
import ErrorBoundary from './components/common/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="Đã xảy ra sự cố giao diện">
      <ThemeProvider>
        <I18nProvider>
          <DialogProvider>
            <AppProvider>
              <MainLayout />
            </AppProvider>
          </DialogProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}