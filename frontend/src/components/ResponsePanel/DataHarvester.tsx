import React, { useState, useMemo, useCallback } from 'react';
import { useApp, KeyValueRow, ParamPair } from '../../context/AppContext';
import { isSafeExternalUrl } from '../../utils/requestHelpers';
import { confirmDialog } from '../common/Dialog';

const NUMBER_TYPE_LABEL: Record<string, string> = {
  price: 'giá tiền', percentage: 'phần trăm', rating: 'đánh giá', phone: 'số điện thoại',
  json_number: 'số JSON', count: 'chỉ số đếm', generic: 'số'
};

// Links come from untrusted pages: only http(s) may be opened.
const openExternal = (url: string) => {
  if (isSafeExternalUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
};
import {
  HarvesterResult,
  ExtractedTextItem,
  ExtractedNumberItem,
  ExtractedImageItem,
  ExtractedLinkItem,
  ExtractedTableData,
  harvestResponseData,
  detectImageFormat,
  extractFilenameFromUrl,
  queryByCssSelector,
  queryByRegex,
  exportToCsvString
} from '../../utils/dataHarvesterEngine';
import {
  exportMultiSheetExcel,
  exportToExcel,
  exportToCsv,
  exportToJson,
  downloadImageDirect
} from '../../utils/exportHelper';

interface DataHarvesterProps {
  body: string;
  contentType?: string;
  baseUrl?: string;
}

/**
 * Trả về tên hiển thị tối ưu nhất cho hình ảnh
 */
export function getImageDisplayName(img: ExtractedImageItem): string {
  if (
    img.alt &&
    !img.alt.startsWith('$') &&
    img.alt !== 'Ảnh trang web' &&
    img.alt !== 'Image' &&
    img.alt !== 'Background image' &&
    img.alt !== img.source
  ) {
    return img.alt;
  }
  const filename = extractFilenameFromUrl(img.url);
  if (filename) return filename;
  return img.alt || img.source || 'Image';
}

export default function DataHarvester({ body, contentType = '', baseUrl = '' }: DataHarvesterProps) {
  const { activeTab, updateActiveTab, environments, activeEnvId, saveEnvironment } = useApp();

  // Active sub-navigation
  const [activeTabSub, setActiveTabSub] = useState<'overview' | 'text' | 'number' | 'image' | 'link' | 'table' | 'custom'>('overview');

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [imageFormatFilter, setImageFormatFilter] = useState<string>('all');
  const [numberTypeFilter, setNumberTypeFilter] = useState<string>('all');
  const [textTypeFilter, setTextTypeFilter] = useState<string>('all');

  // Custom Selector state
  const [customMode, setCustomMode] = useState<'css' | 'jsonpath' | 'regex'>('css');
  const [customQuery, setCustomQuery] = useState('');
  const [regexFlags, setRegexFlags] = useState('gi');

  // Lightbox Modal for Image
  const [lightboxImage, setLightboxImage] = useState<ExtractedImageItem | null>(null);

  // Variable saving modal
  const [savingVariableItem, setSavingVariableItem] = useState<{ key: string; value: string } | null>(null);
  const [customVarName, setCustomVarName] = useState('');
  const [selectedEnvForVar, setSelectedEnvForVar] = useState<string>(activeEnvId === 'none' ? (environments[0]?.id || '') : activeEnvId);

  // Toast feedback
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  // Run extraction
  const data: HarvesterResult = useMemo(() => {
    return harvestResponseData(body, contentType, baseUrl);
  }, [body, contentType, baseUrl]);

  // Filtered Texts
  const filteredTexts = useMemo(() => {
    return data.texts.filter(t => {
      if (textTypeFilter !== 'all' && t.type !== textTypeFilter) return false;
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return t.value.toLowerCase().includes(term) || t.label.toLowerCase().includes(term);
    });
  }, [data.texts, textTypeFilter, searchTerm]);

  // Filtered Numbers
  const filteredNumbers = useMemo(() => {
    return data.numbers.filter(n => {
      if (numberTypeFilter !== 'all' && n.type !== numberTypeFilter) return false;
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return n.rawText.toLowerCase().includes(term) || n.label.toLowerCase().includes(term);
    });
  }, [data.numbers, numberTypeFilter, searchTerm]);

  // Available image formats
  const availableImageFormats = useMemo(() => {
    const formats = new Set<string>();
    data.images.forEach(img => formats.add(img.format.toLowerCase()));
    return Array.from(formats);
  }, [data.images]);

  // Filtered Images
  const filteredImages = useMemo(() => {
    return data.images.filter(img => {
      if (imageFormatFilter !== 'all' && img.format.toLowerCase() !== imageFormatFilter.toLowerCase()) return false;
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const displayName = getImageDisplayName(img).toLowerCase();
      return img.url.toLowerCase().includes(term) || img.alt.toLowerCase().includes(term) || img.source.toLowerCase().includes(term) || displayName.includes(term);
    });
  }, [data.images, imageFormatFilter, searchTerm]);

  // Filtered Links
  const filteredLinks = useMemo(() => {
    return data.links.filter(l => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return l.url.toLowerCase().includes(term) || l.text.toLowerCase().includes(term);
    });
  }, [data.links, searchTerm]);

  // Custom Query execution
  const customQueryResults = useMemo(() => {
    if (!customQuery.trim()) return null;
    if (customMode === 'css') {
      return queryByCssSelector(body, customQuery, baseUrl);
    }
    if (customMode === 'regex') {
      const matches = queryByRegex(body, customQuery, regexFlags);
      return { texts: matches, attributes: [], elementsCount: matches.length };
    }
    if (customMode === 'jsonpath') {
      // Basic JSONPath extractor: $.path.to[0].field
      try {
        const parsed = JSON.parse(body);
        const clean = customQuery.trim().replace(/^\$\.?/, '');
        const parts = clean.split(/[.\[\]]/).filter(Boolean);
        let cur = parsed;
        for (const p of parts) {
          if (cur === undefined || cur === null) break;
          cur = cur[p];
        }
        if (cur !== undefined && cur !== null) {
          const texts = Array.isArray(cur) ? cur.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)) : [typeof cur === 'object' ? JSON.stringify(cur, null, 2) : String(cur)];
          return { texts, attributes: [], elementsCount: texts.length };
        }
      } catch {
        // error
      }
      return { texts: [], attributes: [], elementsCount: 0 };
    }
    return null;
  }, [body, customMode, customQuery, regexFlags, baseUrl]);

  // Action: Copy text
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`✓ Đã sao chép ${label}`);
  };

  // Action: Download single image directly
  const handleDownloadImage = async (url: string, name?: string) => {
    try {
      const saved = await downloadImageDirect(url, name || 'image');
      if (saved) {
        showToast('✓ Đã lưu file ảnh thành công!');
      }
    } catch {
      openExternal(url);
      showToast('↗ Đã mở ảnh trong tab mới');
    }
  };

  // Action: Batch download all filtered images directly
  const handleBatchDownloadImages = async () => {
    if (filteredImages.length === 0) return;
    if (filteredImages.length > 20) {
      const confirmed = await confirmDialog({
        title: 'Tải hàng loạt hình ảnh',
        message: `Bạn có chắc muốn tải về máy ${filteredImages.length} file ảnh cùng lúc không?`,
        variant: 'warning',
        confirmText: 'Bắt đầu tải',
        cancelText: 'Hủy'
      });
      if (!confirmed) {
        return;
      }
    }
    filteredImages.forEach((img, idx) => {
      setTimeout(() => {
        handleDownloadImage(img.url, getImageDisplayName(img));
      }, idx * 250);
    });
    showToast(`📥 Đang tiến hành tải ${filteredImages.length} hình ảnh...`);
  };

  // Action: Export All as JSON
  const handleExportJson = async () => {
    const exportData = {
      source: baseUrl || 'Direct API/Web Response',
      type: data.isHtml ? 'Website (HTML)' : (data.isJson ? 'API (JSON)' : 'Raw Response'),
      exportedAt: new Date().toISOString(),
      summary: data.summary,
      numberStatistics: data.numberStats,
      texts: data.texts,
      numbers: data.numbers,
      images: data.images,
      links: data.links,
      tables: data.tables
    };
    const saved = await exportToJson(exportData, `collected_data_${Date.now()}.json`);
    if (saved) {
      showToast('✓ Đã lưu toàn bộ dữ liệu ra tệp JSON!');
    }
  };

  // Action: Export Numbers to CSV (with UTF-8 BOM for Excel)
  const handleExportNumbersCsv = async () => {
    const records = data.numbers.map(n => ({
      'ID': n.id,
      'Loại': n.type,
      'Nhãn / Vị trí': n.label,
      'Giá trị số': n.value,
      'Văn bản gốc': n.rawText
    }));
    const saved = await exportToCsv(records, `collected_numbers_${Date.now()}.csv`);
    if (saved) {
      showToast('✓ Đã lưu bảng số liệu ra CSV (UTF-8)!');
    }
  };

  // Action: Export Multi-sheet Excel (.xlsx)
  const handleExportExcel = async () => {
    const sheets: Record<string, any[]> = {};
    if (data.texts.length > 0) {
      sheets['Văn bản (Texts)'] = data.texts.map((t, idx) => ({
        'STT': idx + 1,
        'Loại': t.type,
        'Nhãn': t.label,
        'Nội dung': t.value,
        'Độ dài': t.length
      }));
    }
    if (data.numbers.length > 0) {
      sheets['Số liệu (Numbers)'] = data.numbers.map((n, idx) => ({
        'STT': idx + 1,
        'Loại': n.type,
        'Nhãn': n.label,
        'Giá trị': n.value,
        'Văn bản gốc': n.rawText
      }));
    }
    if (data.images.length > 0) {
      sheets['Hình ảnh (Images)'] = data.images.map((img, idx) => ({
        'STT': idx + 1,
        'Tên / Tiêu đề': getImageDisplayName(img),
        'Mô tả (Alt)': img.alt,
        'Định dạng': img.format.toUpperCase(),
        'Loại': img.type,
        'Đường dẫn URL': img.url,
        'Nguồn (Source)': img.source,
        'Kích thước': `${img.width || '?'}x${img.height || '?'}`
      }));
    }
    if (data.links.length > 0) {
      sheets['Liên kết (Links)'] = data.links.map((lnk, idx) => ({
        'STT': idx + 1,
        'Văn bản': lnk.text,
        'Đường dẫn URL': lnk.url,
        'Loại': lnk.isExternal ? 'Ngoài miền' : 'Nội bộ'
      }));
    }
    if (data.tables.length > 0) {
      data.tables.forEach((tbl, tIdx) => {
        const sheetName = (tbl.caption ? tbl.caption : `Bảng ${tIdx + 1}`).substring(0, 31);
        const rowsObj = tbl.rows.map((row, rIdx) => {
          const rowObj: Record<string, any> = { 'STT': rIdx + 1 };
          tbl.headers.forEach((h, hIdx) => {
            rowObj[h || `Cột ${hIdx + 1}`] = row[hIdx] ?? '';
          });
          return rowObj;
        });
        sheets[sheetName] = rowsObj;
      });
    }

    const saved = await exportMultiSheetExcel(sheets, `collected_data_${Date.now()}.xlsx`);
    if (saved) {
      showToast('✓ Đã lưu toàn bộ dữ liệu ra tệp Excel (.xlsx) đa Sheet!');
    }
  };

  // Action: Export Single Table to CSV
  const handleExportTableCsv = async (table: ExtractedTableData) => {
    const rowsObj = table.rows.map((row, rIdx) => {
      const rowObj: Record<string, any> = { 'STT': rIdx + 1 };
      table.headers.forEach((h, hIdx) => {
        rowObj[h || `Cột ${hIdx + 1}`] = row[hIdx] ?? '';
      });
      return rowObj;
    });
    const saved = await exportToCsv(rowsObj, `${(table.caption || 'table').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.csv`);
    if (saved) {
      showToast(`✓ Đã lưu "${table.caption || 'Bảng'}" ra CSV!`);
    }
  };

  // Action: Export Single Table to Excel
  const handleExportTableExcel = async (table: ExtractedTableData) => {
    const rowsObj = table.rows.map((row, rIdx) => {
      const rowObj: Record<string, any> = { 'STT': rIdx + 1 };
      table.headers.forEach((h, hIdx) => {
        rowObj[h || `Cột ${hIdx + 1}`] = row[hIdx] ?? '';
      });
      return rowObj;
    });
    const saved = await exportToExcel(rowsObj, `${(table.caption || 'table').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.xlsx`, table.caption || 'Bảng dữ liệu');
    if (saved) {
      showToast(`✓ Đã lưu "${table.caption || 'Bảng'}" ra Excel (.xlsx)!`);
    }
  };

  // Action: Open Variable Save Dialog
  const handlePromptSaveVariable = (itemKey: string, itemVal: string) => {
    setSavingVariableItem({ key: itemKey, value: itemVal });
    const cleanKey = itemKey.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().replace(/^_+|_+$/g, '');
    setCustomVarName(cleanKey || 'var_' + Date.now().toString().slice(-4));
    setSelectedEnvForVar(activeEnvId === 'none' ? (environments[0]?.id || '') : activeEnvId);
  };

  // Action: Confirm Save to Environment
  const handleConfirmSaveVariable = async () => {
    if (!savingVariableItem || !customVarName.trim()) return;
    const targetEnv = environments.find(e => e.id === selectedEnvForVar) || environments[0];
    if (!targetEnv) {
      showToast('⚠️ Không tìm thấy Môi trường để lưu!');
      return;
    }
    const varKey = customVarName.trim();
    const existingIndex = targetEnv.variables.findIndex(v => v.key === varKey);
    let updatedVars = [...targetEnv.variables];
    if (existingIndex >= 0) {
      updatedVars[existingIndex] = {
        ...updatedVars[existingIndex],
        value: savingVariableItem.value,
        enabled: true
      };
    } else {
      updatedVars.push({
        id: 'v_' + Date.now(),
        key: varKey,
        value: savingVariableItem.value,
        enabled: true
      });
    }

    await saveEnvironment({
      ...targetEnv,
      variables: updatedVars
    });

    showToast(`✓ Đã lưu biến {{${varKey}}} vào môi trường "${targetEnv.name}"!`);
    setSavingVariableItem(null);
  };

  // Action: Apply text or number to Request Query Params
  const handleApplyToQueryParams = (keyName: string, val: string) => {
    if (!activeTab) return;
    const newParam: ParamPair = {
      id: Math.random().toString(36).substring(2, 9),
      key: keyName.replace(/[^a-zA-Z0-9_-]/g, '_'),
      value: val,
      enabled: true
    };
    updateActiveTab({
      paramsList: [...(activeTab.paramsList || []), newParam]
    });
    showToast(`✓ Đã thêm vào Query Params: ${newParam.key}=${val}`);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      height: '100%',
      minHeight: 0,
      background: 'var(--bg-app)',
      color: 'var(--text-main)',
      overflow: 'hidden',
      fontFamily: 'var(--font-sans)'
    }}>
      {/* ── Top Header Toolbar ── */}
      <div style={{
        padding: '10px 16px',
        background: 'var(--bg-surface-secondary)',
        borderBottom: '1px solid var(--border-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--color-primary)'
          }}>
            <span style={{ fontSize: '16px' }}>🕷️</span>
            <span>Bộ Thu Thập Dữ Liệu {data.isHtml ? 'Trang Web (HTML)' : (data.isJson ? 'API (JSON)' : 'Nội Dung')}</span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 8px',
            background: 'var(--color-primary-bg)',
            border: '1px solid var(--border-focus)',
            borderRadius: '12px',
            fontSize: '11px',
            color: 'var(--color-primary)'
          }}>
            <span>Tổng cộng:</span>
            <strong style={{ color: 'var(--text-main)' }}>{data.summary.totalItems} mục</strong>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleExportJson}
            title="Xuất toàn bộ văn bản, số liệu, ảnh, liên kết ra file JSON"
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              color: '#34d399',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>💾 Xuất JSON</span>
          </button>

          <button
            onClick={handleExportNumbersCsv}
            title="Xuất bảng số liệu ra file CSV (UTF-8)"
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              color: '#fbbf24',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>📊 Xuất CSV</span>
          </button>

          <button
            onClick={handleExportExcel}
            title="Xuất toàn bộ báo cáo tổng hợp và các bảng ra file Excel đa Sheet (.xlsx)"
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              color: '#22c55e',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>📗 Xuất Excel</span>
          </button>

          {data.images.length > 0 && (
            <button
              onClick={handleBatchDownloadImages}
              title="Tải toàn bộ hình ảnh đã thu thập"
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                background: 'rgba(168, 85, 247, 0.15)',
                border: '1px solid rgba(168, 85, 247, 0.35)',
                color: '#c084fc',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>🖼️ Tải Tất Cả Ảnh ({data.images.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Sub Navigation Tabs ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-card)',
        overflowX: 'auto',
        gap: '4px',
        flexShrink: 0
      }}>
        {[
          { key: 'overview', label: '📊 Tổng quan', count: data.summary.totalItems },
          { key: 'text', label: '📝 Văn bản (Text)', count: data.summary.textCount, color: '#10b981' },
          { key: 'number', label: '🔢 Số liệu (Numbers)', count: data.summary.numberCount, color: '#f59e0b' },
          { key: 'image', label: '🖼️ Hình ảnh (Images)', count: data.summary.imageCount, color: '#a855f7' },
          { key: 'link', label: '🔗 Liên kết (Links)', count: data.summary.linkCount, color: '#3b82f6' },
          { key: 'table', label: '📊 Bảng biểu (Tables)', count: data.summary.tableCount, color: '#ec4899' },
          { key: 'custom', label: '🎯 Bóc tách tùy biến', count: undefined, color: 'var(--color-primary)' }
        ].map(tab => {
          const isActive = activeTabSub === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTabSub(tab.key as any)}
              style={{
                padding: '7px 12px',
                fontSize: '11.5px',
                fontWeight: isActive ? 700 : 500,
                background: 'transparent',
                color: isActive ? (tab.color || 'var(--color-primary)') : 'var(--text-muted)',
                borderBottom: isActive ? `2px solid ${tab.color || 'var(--color-primary)'}` : '2px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span style={{
                  fontSize: '10px',
                  padding: '1px 5px',
                  borderRadius: '10px',
                  background: isActive ? 'var(--color-primary-bg)' : 'var(--bg-surface-secondary)',
                  color: isActive ? 'var(--color-primary)' : 'var(--text-dim)'
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Search & Filter Bar (for text, number, image, link) ── */}
      {activeTabSub !== 'overview' && activeTabSub !== 'custom' && (
        <div style={{
          padding: '8px 16px',
          background: 'var(--bg-surface-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          flexShrink: 0
        }}>
          {/* Search box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-card)',
              borderRadius: '6px',
              padding: '4px 10px',
              width: '100%',
              maxWidth: '420px',
              gap: '6px'
            }}>
              <span style={{ fontSize: '12px', opacity: 0.6 }}>🔍</span>
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Tìm kiếm nội dung, đường dẫn, từ khóa..."
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-main)',
                  fontSize: '12px',
                  width: '100%'
                }}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '11px' }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Type filters */}
          {activeTabSub === 'image' && availableImageFormats.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Định dạng:</span>
              <button
                onClick={() => setImageFormatFilter('all')}
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  background: imageFormatFilter === 'all' ? '#a855f7' : 'var(--bg-card)',
                  color: imageFormatFilter === 'all' ? '#fff' : 'var(--text-muted)',
                  border: '1px solid var(--border-card)',
                  cursor: 'pointer'
                }}
              >
                Tất cả ({data.images.length})
              </button>
              {availableImageFormats.map(fmt => (
                <button
                  key={fmt}
                  onClick={() => setImageFormatFilter(fmt)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    background: imageFormatFilter === fmt ? '#a855f7' : 'var(--bg-card)',
                    color: imageFormatFilter === fmt ? '#fff' : 'var(--text-muted)',
                    border: '1px solid var(--border-card)',
                    cursor: 'pointer'
                  }}
                >
                  {fmt}
                </button>
              ))}
            </div>
          )}

          {activeTabSub === 'number' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Phân loại:</span>
              {['all', 'price', 'percentage', 'rating', 'count'].map(t => (
                <button
                  key={t}
                  onClick={() => setNumberTypeFilter(t)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    background: numberTypeFilter === t ? '#f59e0b' : 'var(--bg-card)',
                    color: numberTypeFilter === t ? '#ffffff' : 'var(--text-muted)',
                    border: '1px solid var(--border-card)',
                    cursor: 'pointer'
                  }}
                >
                  {t === 'all' ? 'Tất cả' : (t === 'price' ? '💰 Giá tiền' : (t === 'percentage' ? '% Phần trăm' : (t === 'rating' ? '⭐ Đánh giá' : '🔢 Đếm')))}
                </button>
              ))}
            </div>
          )}

          {activeTabSub === 'text' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Thẻ:</span>
              {['all', 'title', 'heading', 'paragraph', 'meta'].map(t => (
                <button
                  key={t}
                  onClick={() => setTextTypeFilter(t)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    background: textTypeFilter === t ? '#10b981' : 'var(--bg-card)',
                    color: textTypeFilter === t ? '#ffffff' : 'var(--text-muted)',
                    border: '1px solid var(--border-card)',
                    cursor: 'pointer'
                  }}
                >
                  {t === 'all' ? 'Tất cả' : (t === 'title' ? 'Tiêu đề' : (t === 'heading' ? 'Headings' : (t === 'paragraph' ? 'Đoạn văn' : 'Meta')))}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Main Tab Content ── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '16px'
      }}>
        {/* 1. OVERVIEW TAB */}
        {activeTabSub === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1200px', margin: '0 auto' }}>
            {/* Cards Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px'
            }}>
              {/* Text Card */}
              <div
                onClick={() => setActiveTabSub('text')}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: '8px',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'transform 0.15s, border-color 0.15s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#10b981' }}>📝 Văn bản & Chuỗi</span>
                  <span style={{ fontSize: '18px' }}>📑</span>
                </div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-main)', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>
                  {data.summary.textCount}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Tiêu đề, đoạn văn, meta tags, chuỗi API
                </div>
              </div>

              {/* Number Card */}
              <div
                onClick={() => setActiveTabSub('number')}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  borderRadius: '8px',
                  padding: '16px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#f59e0b' }}>🔢 Số liệu & Giá tiền</span>
                  <span style={{ fontSize: '18px' }}>💰</span>
                </div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-main)', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>
                  {data.summary.numberCount}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {data.numberStats.count > 0 ? `Min: ${data.numberStats.min} · Max: ${data.numberStats.max} · Avg: ${data.numberStats.avg}` : 'Giá cả, tỷ lệ %, chỉ số đếm'}
                </div>
              </div>

              {/* Image Card */}
              <div
                onClick={() => setActiveTabSub('image')}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid rgba(168, 85, 247, 0.35)',
                  borderRadius: '8px',
                  padding: '16px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#a855f7' }}>🖼️ Hình ảnh & Media</span>
                  <span style={{ fontSize: '18px' }}>📸</span>
                </div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-main)', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>
                  {data.summary.imageCount}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Thẻ img, banner, logo, svg, avatar
                </div>
              </div>

              {/* Link Card */}
              <div
                onClick={() => setActiveTabSub('link')}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  borderRadius: '8px',
                  padding: '16px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#3b82f6' }}>🔗 Liên kết (Links)</span>
                  <span style={{ fontSize: '18px' }}>🌐</span>
                </div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-main)', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>
                  {data.summary.linkCount}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Đường dẫn trang web & API URLs
                </div>
              </div>

              {/* Table Card */}
              <div
                onClick={() => setActiveTabSub('table')}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid rgba(236, 72, 153, 0.35)',
                  borderRadius: '8px',
                  padding: '16px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#ec4899' }}>📊 Bảng biểu (Tables)</span>
                  <span style={{ fontSize: '18px' }}>📑</span>
                </div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-main)', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>
                  {data.summary.tableCount}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Bảng dữ liệu có cấu trúc dòng & cột
                </div>
              </div>
            </div>

            {/* Quick Preview Highlight Sections */}
            {data.images.length > 0 && (
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: '8px',
                padding: '14px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#a855f7' }}>
                    📸 Ảnh nổi bật vừa thu thập ({data.images.length} ảnh):
                  </span>
                  <button
                    onClick={() => setActiveTabSub('image')}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Xem tất cả trong Thư Viện Ảnh →
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '6px' }}>
                  {data.images.slice(0, 8).map(img => (
                    <div
                      key={img.id}
                      onClick={() => setLightboxImage(img)}
                      style={{
                        width: '90px',
                        height: '90px',
                        flexShrink: 0,
                        borderRadius: '6px',
                        overflow: 'hidden',
                        background: 'var(--bg-surface-secondary)',
                        border: '1px solid var(--border-card)',
                        cursor: 'pointer',
                        position: 'relative'
                      }}
                    >
                      <img
                        src={img.url}
                        alt={img.alt}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e: any) => { e.target.style.display = 'none'; }}
                      />
                      <span style={{
                        position: 'absolute',
                        bottom: '2px',
                        right: '2px',
                        fontSize: '8.5px',
                        fontWeight: 700,
                        background: 'rgba(0,0,0,0.7)',
                        color: '#c084fc',
                        padding: '1px 3px',
                        borderRadius: '3px',
                        textTransform: 'uppercase'
                      }}>
                        {img.format}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Numbers Statistics Bar */}
            {data.numberStats.count > 0 && (
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: '8px',
                padding: '14px'
              }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', display: 'block', marginBottom: '10px' }}>
                  📈 Thống kê số liệu phát hiện{data.numberStats.type ? ` (${NUMBER_TYPE_LABEL[data.numberStats.type] || data.numberStats.type})` : ''}:
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                  <div style={{ background: 'var(--bg-surface-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Tổng số mục</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{data.numberStats.count}</div>
                  </div>
                  <div style={{ background: 'var(--bg-surface-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Giá trị nhỏ nhất (Min)</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#10b981', fontFamily: 'var(--font-mono)' }}>{data.numberStats.min}</div>
                  </div>
                  <div style={{ background: 'var(--bg-surface-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Giá trị lớn nhất (Max)</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>{data.numberStats.max}</div>
                  </div>
                  <div style={{ background: 'var(--bg-surface-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Trung bình (Average)</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{data.numberStats.avg}</div>
                  </div>
                  <div style={{ background: 'var(--bg-surface-secondary)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Tổng cộng (Sum)</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-primary)', fontFamily: 'var(--font-mono)' }}>{data.numberStats.sum}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. TEXT TAB */}
        {activeTabSub === 'text' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '4px' }}>
              Hiển thị {filteredTexts.length} / {data.texts.length} mục văn bản:
            </div>
            {filteredTexts.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>
                Không tìm thấy văn bản phù hợp với bộ lọc
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredTexts.map(item => (
                  <div
                    key={item.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '6px',
                      padding: '10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: item.type === 'heading' ? 'rgba(56, 189, 248, 0.2)' : (item.type === 'title' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(16, 185, 129, 0.2)'),
                          color: item.type === 'heading' ? '#38bdf8' : (item.type === 'title' ? '#c084fc' : '#34d399')
                        }}>
                          {item.label}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                          {item.context}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button
                          onClick={() => handleCopy(item.value, 'nội dung văn bản')}
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-main)',
                            fontSize: '10.5px',
                            cursor: 'pointer'
                          }}
                        >
                          📋 Chép
                        </button>
                        <button
                          onClick={() => handlePromptSaveVariable(item.label, item.value)}
                          title="Lưu giá trị vào biến môi trường {{var}}"
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: 'var(--color-primary-bg)',
                            border: '1px solid var(--border-focus)',
                            color: 'var(--color-primary)',
                            fontSize: '10.5px',
                            cursor: 'pointer'
                          }}
                        >
                          🏷️ Lưu {'{{var}}'}
                        </button>
                        <button
                          onClick={() => handleApplyToQueryParams(item.label, item.value)}
                          title="Gắn vào Query Params của tab hiện tại"
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-muted)',
                            fontSize: '10.5px',
                            cursor: 'pointer'
                          }}
                        >
                          + Params
                        </button>
                      </div>
                    </div>

                    <div style={{
                      fontSize: '12.5px',
                      color: 'var(--text-main)',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '120px',
                      overflowY: 'auto'
                    }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. NUMBER TAB */}
        {activeTabSub === 'number' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                Hiển thị {filteredNumbers.length} / {data.numbers.length} số liệu:
              </span>
              <button
                onClick={handleExportNumbersCsv}
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: '#fbbf24',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                📊 Xuất CSV
              </button>
            </div>

            {filteredNumbers.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>
                Không tìm thấy số liệu phù hợp
              </div>
            ) : (
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: '8px',
                overflow: 'hidden'
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface-secondary)', color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-card)' }}>
                      <th style={{ padding: '8px 12px', width: '120px' }}>Loại</th>
                      <th style={{ padding: '8px 12px' }}>Vị trí / Nguồn</th>
                      <th style={{ padding: '8px 12px', width: '150px' }}>Văn bản gốc</th>
                      <th style={{ padding: '8px 12px', width: '140px', textAlign: 'right' }}>Giá trị số</th>
                      <th style={{ padding: '8px 12px', width: '170px', textAlign: 'center' }}>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNumbers.map((n, idx) => (
                      <tr key={n.id || idx} style={{ borderBottom: '1px solid var(--border-subtle)', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: n.type === 'price' ? 'rgba(245, 158, 11, 0.2)' : (n.type === 'percentage' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)'),
                            color: n.type === 'price' ? '#fbbf24' : (n.type === 'percentage' ? '#34d399' : '#38bdf8')
                          }}>
                            {n.type === 'price' ? 'Giá tiền' : (n.type === 'percentage' ? 'Phần trăm' : (n.type === 'rating' ? 'Đánh giá' : 'Số liệu'))}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                          {n.label}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                          {n.rawText}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '13px' }}>
                          {n.value.toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                            <button
                              onClick={() => handleCopy(String(n.value), 'giá trị số')}
                              title="Sao chép"
                              style={{ padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)', fontSize: '10px', cursor: 'pointer' }}
                            >
                              📋
                            </button>
                            <button
                              onClick={() => handlePromptSaveVariable(n.label, String(n.value))}
                              title="Lưu vào biến môi trường {{var}}"
                              style={{ padding: '2px 6px', borderRadius: '4px', background: 'var(--color-primary-bg)', border: '1px solid var(--border-focus)', color: 'var(--color-primary)', fontSize: '10px', cursor: 'pointer' }}
                            >
                              🏷️ Lưu
                            </button>
                            <button
                              onClick={() => handleApplyToQueryParams(n.label, String(n.value))}
                              title="Thêm vào Query Params"
                              style={{ padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer' }}
                            >
                              + Param
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 4. IMAGE GALLERY TAB */}
        {activeTabSub === 'image' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                Hiển thị {filteredImages.length} / {data.images.length} hình ảnh:
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => {
                    const urls = filteredImages.map(img => img.url).join('\n');
                    navigator.clipboard.writeText(urls);
                    showToast(`✓ Đã sao chép ${filteredImages.length} URL hình ảnh`);
                  }}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-main)',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  📋 Chép Tất Cả URL
                </button>
                <button
                  onClick={handleBatchDownloadImages}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: 'rgba(168, 85, 247, 0.15)',
                    border: '1px solid rgba(168, 85, 247, 0.35)',
                    color: '#c084fc',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  📥 Tải Tất Cả Ảnh ({filteredImages.length})
                </button>
              </div>
            </div>

            {filteredImages.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
                Không tìm thấy hình ảnh nào phù hợp
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '12px'
              }}>
                {filteredImages.map(img => (
                  <div
                    key={img.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'transform 0.15s, border-color 0.15s'
                    }}
                  >
                    {/* Thumbnail Viewport */}
                    <div
                      onClick={() => setLightboxImage(img)}
                      style={{
                        height: '140px',
                        background: 'var(--bg-surface-secondary)',
                        position: 'relative',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden'
                      }}
                    >
                      <img
                        src={img.url}
                        alt={img.alt}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain'
                        }}
                        onError={(e: any) => {
                          e.target.style.display = 'none';
                        }}
                      />

                      {/* Format Badge */}
                      <span style={{
                        position: 'absolute',
                        top: '6px',
                        left: '6px',
                        fontSize: '9px',
                        fontWeight: 800,
                        background: 'rgba(0,0,0,0.75)',
                        color: '#c084fc',
                        border: '1px solid rgba(168, 85, 247, 0.4)',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        textTransform: 'uppercase'
                      }}>
                        {img.format}
                      </span>

                      {/* Hover Overlay Hint */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(0,0,0,0.4)',
                          opacity: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 600,
                          transition: 'opacity 0.15s'
                        }}
                        onMouseEnter={(e: any) => { e.currentTarget.style.opacity = '1'; }}
                        onMouseLeave={(e: any) => { e.currentTarget.style.opacity = '0'; }}
                      >
                        🔍 Xem phóng to
                      </div>
                    </div>

                    {/* Metadata & Actions Footer */}
                    <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {/* Tên ảnh hiển thị nổi bật */}
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-main)',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: '1.3'
                        }}
                        title={getImageDisplayName(img)}
                      >
                        {getImageDisplayName(img)}
                      </div>

                      {/* Nguồn / JSONPath / Tag Selector */}
                      {img.source && (
                        <div
                          style={{
                            fontSize: '10px',
                            color: 'var(--text-dim)',
                            fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                          title={`Nguồn trích xuất: ${img.source}`}
                        >
                          {img.source}
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', marginTop: '2px' }}>
                        <button
                          onClick={() => handleCopy(img.url, 'đường dẫn ảnh')}
                          title="Sao chép URL"
                          style={{
                            flex: 1,
                            padding: '4px 0',
                            borderRadius: '4px',
                            background: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-muted)',
                            fontSize: '10.5px',
                            cursor: 'pointer'
                          }}
                        >
                          📋 Link
                        </button>
                        <button
                          onClick={() => handleDownloadImage(img.url, getImageDisplayName(img))}
                          title={`Tải ảnh về máy: ${getImageDisplayName(img)}`}
                          style={{
                            flex: 1,
                            padding: '4px 0',
                            borderRadius: '4px',
                            background: 'rgba(168, 85, 247, 0.15)',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            color: '#c084fc',
                            fontSize: '10.5px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          💾 Tải
                        </button>
                        <button
                          onClick={() => handlePromptSaveVariable('image_url', img.url)}
                          title="Lưu URL vào biến môi trường {{var}}"
                          style={{
                            padding: '4px 6px',
                            borderRadius: '4px',
                            background: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--color-primary)',
                            fontSize: '10.5px',
                            cursor: 'pointer'
                          }}
                        >
                          🏷️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 5. LINKS TAB */}
        {activeTabSub === 'link' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '4px' }}>
              Hiển thị {filteredLinks.length} / {data.links.length} liên kết:
            </div>
            {filteredLinks.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>
                Không tìm thấy liên kết phù hợp
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredLinks.map((l, idx) => (
                  <div
                    key={l.id || idx}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-main)', fontWeight: 600 }}>
                        {l.text || l.url}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.url}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <button
                        onClick={() => handleCopy(l.url, 'URL')}
                        style={{ padding: '3px 8px', borderRadius: '4px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)', fontSize: '10.5px', cursor: 'pointer' }}
                      >
                        📋 Chép
                      </button>
                      <button
                        onClick={() => openExternal(l.url)}
                        disabled={!isSafeExternalUrl(l.url)}
                        style={{ padding: '3px 8px', borderRadius: '4px', background: 'var(--color-primary-bg)', border: '1px solid var(--border-focus)', color: 'var(--color-primary)', fontSize: '10.5px', cursor: 'pointer' }}
                      >
                        ↗ Mở
                      </button>
                      <button
                        onClick={() => handlePromptSaveVariable('link_url', l.url)}
                        style={{ padding: '3px 6px', borderRadius: '4px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', color: '#c084fc', fontSize: '10.5px', cursor: 'pointer' }}
                      >
                        🏷️ Lưu
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 6. TABLES TAB */}
        {activeTabSub === 'table' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {data.tables.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
                Không tìm thấy bảng dữ liệu có cấu trúc (Table / JSON Array of Objects)
              </div>
            ) : (
              data.tables.map((table, tIdx) => (
                <div
                  key={table.id || tIdx}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#f472b6' }}>
                        📊 {table.caption || `Bảng dữ liệu #${tIdx + 1}`}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                        ({table.rows.length} dòng · {table.headers.length} cột)
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => handleExportTableCsv(table)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: '4px',
                          background: 'rgba(236, 72, 153, 0.15)',
                          border: '1px solid rgba(236, 72, 153, 0.3)',
                          color: '#f472b6',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        📊 Xuất CSV
                      </button>
                      <button
                        onClick={() => handleExportTableExcel(table)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: '4px',
                          background: 'rgba(34, 197, 94, 0.15)',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                          color: '#22c55e',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        📗 Xuất Excel
                      </button>
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto', maxHeight: '300px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-surface-secondary)', color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-card)' }}>
                          {table.headers.map((h, i) => (
                            <th key={i} style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, rIdx) => (
                          <tr key={rIdx} style={{ borderBottom: '1px solid var(--border-subtle)', background: rIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} style={{ padding: '6px 10px', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 7. CUSTOM QUERY / SELECTOR TAB */}
        {activeTabSub === 'custom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-primary)' }}>
                  🎯 Công cụ bóc tách tùy biến trực tiếp:
                </span>

                {/* Mode Selector */}
                <div style={{ display: 'flex', background: 'var(--bg-input)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                  <button
                    onClick={() => { setCustomMode('css'); setCustomQuery(''); }}
                    style={{
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: customMode === 'css' ? 'var(--color-primary)' : 'transparent',
                      color: customMode === 'css' ? '#ffffff' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    CSS Selector (HTML)
                  </button>
                  <button
                    onClick={() => { setCustomMode('jsonpath'); setCustomQuery(''); }}
                    style={{
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: customMode === 'jsonpath' ? 'var(--color-primary)' : 'transparent',
                      color: customMode === 'jsonpath' ? '#ffffff' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    JSONPath (API)
                  </button>
                  <button
                    onClick={() => { setCustomMode('regex'); setCustomQuery(''); }}
                    style={{
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: customMode === 'regex' ? 'var(--color-primary)' : 'transparent',
                      color: customMode === 'regex' ? '#ffffff' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Regex Pattern
                  </button>
                </div>
              </div>

              {/* Input bar */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={customQuery}
                  onChange={e => setCustomQuery(e.target.value)}
                  placeholder={
                    customMode === 'css'
                      ? 'Nhập CSS Selector (ví dụ: h2, .price, .product-item img, table tr td)'
                      : (customMode === 'jsonpath'
                        ? 'Nhập JSONPath (ví dụ: $.products[*].title, $.data.items[0].price)'
                        : 'Nhập biểu thức Regex (ví dụ: 09\\d{8}, [a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})')
                  }
                  style={{
                    flex: 1,
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--text-main)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12.5px',
                    outline: 'none'
                  }}
                />

                {customMode === 'regex' && (
                  <input
                    type="text"
                    value={regexFlags}
                    onChange={e => setRegexFlags(e.target.value)}
                    placeholder="Flags (gi)"
                    style={{
                      width: '60px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '6px',
                      padding: '8px',
                      color: '#f59e0b',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      outline: 'none',
                      textAlign: 'center'
                    }}
                  />
                )}
              </div>

              {/* Preset suggestion pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Gợi ý mẫu:</span>
                {customMode === 'css' && [
                  'h1, h2, h3', 'img', 'a[href]', '.price', 'meta', 'table tr'
                ].map(p => (
                  <button
                    key={p}
                    onClick={() => setCustomQuery(p)}
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      background: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--color-primary)',
                      fontSize: '10.5px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {p}
                  </button>
                ))}

                {customMode === 'jsonpath' && [
                  '$.products', '$.items[*].price', '$.data.user.name'
                ].map(p => (
                  <button
                    key={p}
                    onClick={() => setCustomQuery(p)}
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      background: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--color-primary)',
                      fontSize: '10.5px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {p}
                  </button>
                ))}

                {customMode === 'regex' && [
                  '09\\d{8}', '\\d+[\\.,]\\d+', 'https?:\\/\\/\\S+\\.(?:png|jpg|webp)'
                ].map(p => (
                  <button
                    key={p}
                    onClick={() => setCustomQuery(p)}
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      background: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--color-primary)',
                      fontSize: '10.5px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Query Results View */}
            {customQueryResults && (
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: '8px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#10b981' }}>
                    ✓ Kết quả khớp ({customQueryResults.elementsCount} phần tử):
                  </span>
                  <button
                    onClick={() => {
                      const allStr = customQueryResults.texts.join('\n');
                      navigator.clipboard.writeText(allStr);
                      showToast(`✓ Đã sao chép ${customQueryResults.texts.length} kết quả`);
                    }}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      background: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-main)',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    📋 Sao chép toàn bộ kết quả
                  </button>
                </div>

                <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {customQueryResults.texts.length === 0 && customQueryResults.attributes.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
                      Không tìm thấy kết quả nào khớp với selector/regex này
                    </div>
                  ) : (
                    customQueryResults.texts.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--bg-surface-secondary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '6px 10px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '10px'
                        }}
                      >
                        <span style={{ fontSize: '12px', color: 'var(--text-main)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
                          {item}
                        </span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            onClick={() => handleCopy(item, 'kết quả')}
                            style={{ padding: '2px 6px', borderRadius: '3px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)', fontSize: '10px', cursor: 'pointer' }}
                          >
                            📋
                          </button>
                          <button
                            onClick={() => handlePromptSaveVariable('extracted_val', item)}
                            style={{ padding: '2px 6px', borderRadius: '3px', background: 'rgba(56, 189, 248, 0.15)', border: 'none', color: '#38bdf8', fontSize: '10px', cursor: 'pointer' }}
                          >
                            🏷️
                          </button>
                        </div>
                      </div>
                    ))
                  )}

                  {/* Attributes (e.g. image src or href) */}
                  {customQueryResults.attributes.map((attr, idx) => (
                    <div
                      key={`attr_${idx}`}
                      style={{
                        background: 'var(--bg-surface-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        padding: '6px 10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {attr.src && <span style={{ fontSize: '11px', color: '#c084fc' }}>src: {attr.src}</span>}
                        {attr.href && <span style={{ fontSize: '11px', color: '#60a5fa' }}>href: {attr.href}</span>}
                        {attr.alt && <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>alt: {attr.alt}</span>}
                      </div>
                      <button
                        onClick={() => handleCopy(attr.src || attr.href || '', 'URL thuộc tính')}
                        style={{ padding: '2px 6px', borderRadius: '3px', background: 'var(--bg-badge)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)', fontSize: '10px', cursor: 'pointer' }}
                      >
                        📋
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── IMAGE LIGHTBOX MODAL ── */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: '10px',
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-surface-secondary)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#c084fc' }}>
                  🖼️ {getImageDisplayName(lightboxImage)} ({lightboxImage.format.toUpperCase()})
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {lightboxImage.source}
                </span>
              </div>
              <button
                onClick={() => setLightboxImage(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '18px',
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Image Body */}
            <div style={{
              padding: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-app)',
              maxHeight: '65vh',
              overflow: 'auto'
            }}>
              <img
                src={lightboxImage.url}
                alt={getImageDisplayName(lightboxImage)}
                style={{
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  objectFit: 'contain',
                  borderRadius: '6px'
                }}
              />
            </div>

            {/* Modal Footer Toolbar */}
            <div style={{
              padding: '10px 16px',
              borderTop: '1px solid var(--border-card)',
              background: 'var(--bg-surface-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap'
            }}>
              <div style={{ fontSize: '11.5px', color: '#38bdf8', fontFamily: 'var(--font-mono)', maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lightboxImage.url}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleCopy(lightboxImage.url, 'URL ảnh')}
                  style={{ padding: '5px 12px', borderRadius: '4px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  📋 Sao chép URL
                </button>
                <button
                  onClick={() => handleDownloadImage(lightboxImage.url, getImageDisplayName(lightboxImage))}
                  style={{ padding: '5px 12px', borderRadius: '4px', background: '#a855f7', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  💾 Tải xuống ảnh
                </button>
                <button
                  onClick={() => handlePromptSaveVariable('image_url', lightboxImage.url)}
                  style={{ padding: '5px 12px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.4)', color: '#38bdf8', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  🏷️ Lưu {'{{var}}'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SAVE TO ENVIRONMENT VARIABLE MODAL ── */}
      {savingVariableItem && (
        <div
          onClick={() => setSavingVariableItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: '8px',
              padding: '20px',
              width: '450px',
              maxWidth: '90vw',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#38bdf8' }}>
                🏷️ Lưu Dữ Liệu Vào Biến Môi Trường (SQLite)
              </span>
              <button
                onClick={() => setSavingVariableItem(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Chọn Môi trường:</label>
              <select
                value={selectedEnvForVar}
                onChange={e => setSelectedEnvForVar(e.target.value)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-card)',
                  color: 'var(--text-main)',
                  fontSize: '12px'
                }}
              >
                {environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Tên biến (Key) không dấu:</label>
              <input
                type="text"
                value={customVarName}
                onChange={e => setCustomVarName(e.target.value)}
                placeholder="Ví dụ: token, price, image_url"
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-card)',
                  color: '#10b981',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Giá trị sẽ gán:</label>
              <div style={{
                padding: '8px',
                borderRadius: '6px',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-main)',
                fontSize: '11.5px',
                maxHeight: '80px',
                overflowY: 'auto',
                wordBreak: 'break-all',
                fontFamily: 'var(--font-mono)'
              }}>
                {savingVariableItem.value}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={() => setSavingVariableItem(null)}
                style={{ padding: '6px 12px', borderRadius: '4px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmSaveVariable}
                style={{ padding: '6px 14px', borderRadius: '4px', background: 'var(--color-primary)', border: 'none', color: '#000', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
              >
                Lưu vào SQLite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST MESSAGE ── */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: 'var(--bg-card)',
          color: 'var(--text-main)',
          border: '1px solid var(--color-primary)',
          borderRadius: '8px',
          padding: '10px 16px',
          fontSize: '12px',
          fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
          zIndex: 10000,
          animation: 'fade-in 0.2s ease-out'
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}
