import React, { useState, useMemo } from 'react';
import { useApp, KeyValueRow, FormDataRow, ParamPair } from '../../context/AppContext';
import { exportToJson, exportToCsv, exportToExcel } from '../../utils/exportHelper';

export interface ExtractedField {
  id: string;
  tagName: 'input' | 'select' | 'textarea' | 'button';
  type: string;
  name: string;
  value: string;
  elementId: string;
  placeholder: string;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  options?: { value: string; label: string; selected: boolean }[];
  formIndex: number | null;
  formId?: string;
  formName?: string;
  formAction?: string;
  formMethod?: string;
}

export interface ExtractedForm {
  index: number;
  id: string;
  name: string;
  action: string;
  method: string;
  enctype: string;
  fields: ExtractedField[];
}

export interface HtmlFormSummary {
  forms: ExtractedForm[];
  standaloneFields: ExtractedField[];
  allFields: ExtractedField[];
  totalFieldsCount: number;
  hiddenFieldsCount: number;
  formsCount: number;
}

export function parseHtmlFormSummary(html: string): HtmlFormSummary {
  if (!html || typeof html !== 'string') {
    return { forms: [], standaloneFields: [], allFields: [], totalFieldsCount: 0, hiddenFieldsCount: 0, formsCount: 0 };
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const allForms = Array.from(doc.querySelectorAll('form'));
    const parsedForms: ExtractedForm[] = [];
    const allFields: ExtractedField[] = [];

    const parseField = (el: Element, formIdx: number | null, formEl?: HTMLFormElement): ExtractedField => {
      const tag = el.tagName.toLowerCase() as 'input' | 'select' | 'textarea' | 'button';
      let type = el.getAttribute('type')?.toLowerCase() || 'text';
      if (tag === 'select') type = 'select';
      if (tag === 'textarea') type = 'textarea';
      if (tag === 'button') type = el.getAttribute('type')?.toLowerCase() || 'submit';

      let value = el.getAttribute('value') || '';
      if (tag === 'textarea') {
        value = (el as HTMLTextAreaElement).value || el.textContent || '';
      }

      let options: { value: string; label: string; selected: boolean }[] | undefined;
      if (tag === 'select') {
        const optionEls = Array.from(el.querySelectorAll('option'));
        options = optionEls.map(opt => ({
          value: opt.value || opt.getAttribute('value') || '',
          label: opt.textContent?.trim() || opt.value || '',
          selected: opt.hasAttribute('selected')
        }));
        const selectedOpt = options.find(o => o.selected) || options[0];
        if (selectedOpt && !value) value = selectedOpt.value;
      }

      const isChecked = el.hasAttribute('checked');
      if ((type === 'checkbox' || type === 'radio') && !isChecked && !value) {
        value = el.getAttribute('value') || 'on';
      }

      return {
        id: Math.random().toString(36).substring(2, 9),
        tagName: tag,
        type,
        name: el.getAttribute('name') || '',
        value,
        elementId: el.getAttribute('id') || '',
        placeholder: el.getAttribute('placeholder') || '',
        required: el.hasAttribute('required'),
        disabled: el.hasAttribute('disabled'),
        readonly: el.hasAttribute('readonly'),
        options,
        formIndex: formIdx,
        formId: formEl?.getAttribute('id') || '',
        formName: formEl?.getAttribute('name') || '',
        formAction: formEl?.getAttribute('action') || '',
        formMethod: (formEl?.getAttribute('method') || 'GET').toUpperCase()
      };
    };

    allForms.forEach((formEl, fIdx) => {
      const fieldEls = Array.from(formEl.querySelectorAll('input, select, textarea, button[name]'));
      const formFields = fieldEls.map(el => parseField(el, fIdx, formEl as HTMLFormElement));
      parsedForms.push({
        index: fIdx,
        id: formEl.getAttribute('id') || '',
        name: formEl.getAttribute('name') || '',
        action: formEl.getAttribute('action') || '',
        method: (formEl.getAttribute('method') || 'GET').toUpperCase(),
        enctype: formEl.getAttribute('enctype') || 'application/x-www-form-urlencoded',
        fields: formFields
      });
      allFields.push(...formFields);
    });

    // Inputs outside any <form>
    const standaloneEls = Array.from(doc.querySelectorAll('input:not(form input), select:not(form select), textarea:not(form textarea)'));
    const standaloneFields = standaloneEls.map(el => parseField(el, null));
    allFields.push(...standaloneFields);

    const hiddenCount = allFields.filter(f => f.type === 'hidden').length;

    return {
      forms: parsedForms,
      standaloneFields,
      allFields,
      totalFieldsCount: allFields.length,
      hiddenFieldsCount: hiddenCount,
      formsCount: parsedForms.length
    };
  } catch (err) {
    console.error('Error parsing HTML form fields:', err);
    return { forms: [], standaloneFields: [], allFields: [], totalFieldsCount: 0, hiddenFieldsCount: 0, formsCount: 0 };
  }
}

interface HtmlFieldsInspectorProps {
  html: string;
}

export default function HtmlFieldsInspector({ html }: HtmlFieldsInspectorProps) {
  const { activeTab, updateActiveTab } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'hidden' | 'text' | 'select' | 'choice'>('all');
  const [viewGrouping, setViewGrouping] = useState<'forms' | 'flat'>('forms');
  const [expandedValueId, setExpandedValueId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const summary = useMemo(() => parseHtmlFormSummary(html), [html]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`✓ Đã sao chép ${label}`);
  };

  const handleCopyAllJson = (fieldsToCopy: ExtractedField[]) => {
    const obj: Record<string, string> = {};
    fieldsToCopy.forEach(f => {
      const key = f.name || f.elementId || `field_${f.id}`;
      obj[key] = f.value;
    });
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    showToast(`✓ Đã sao chép ${Object.keys(obj).length} trường dạng JSON`);
  };

  const handleCopyAllUrlEncoded = (fieldsToCopy: ExtractedField[]) => {
    const params = new URLSearchParams();
    fieldsToCopy.forEach(f => {
      const key = f.name || f.elementId;
      if (key) params.append(key, f.value);
    });
    navigator.clipboard.writeText(params.toString());
    showToast(`✓ Đã sao chép chuỗi x-www-form-urlencoded`);
  };

  const handleExportJson = async (fieldsToExport: ExtractedField[]) => {
    const records = fieldsToExport.map((f, idx) => ({
      'STT': idx + 1,
      'Thẻ HTML': f.tagName,
      'Loại': f.type,
      'Tên (name)': f.name,
      'ID (id)': f.elementId,
      'Giá trị (value)': f.value,
      'Placeholder': f.placeholder,
      'Bắt buộc': f.required ? 'Có' : 'Không',
      'Form #': f.formIndex !== null ? `Form ${f.formIndex + 1}` : 'Độc lập'
    }));
    const saved = await exportToJson(records, `html_fields_${Date.now()}.json`);
    if (saved) {
      showToast(`✓ Đã lưu ${records.length} trường dạng JSON!`);
    }
  };

  const handleExportCsv = async (fieldsToExport: ExtractedField[]) => {
    const records = fieldsToExport.map((f, idx) => ({
      'STT': idx + 1,
      'Thẻ HTML': f.tagName,
      'Loại': f.type,
      'Tên (name)': f.name,
      'ID (id)': f.elementId,
      'Giá trị (value)': f.value,
      'Placeholder': f.placeholder,
      'Bắt buộc': f.required ? 'Có' : 'Không',
      'Form #': f.formIndex !== null ? `Form ${f.formIndex + 1}` : 'Độc lập'
    }));
    const saved = await exportToCsv(records, `html_fields_${Date.now()}.csv`);
    if (saved) {
      showToast(`✓ Đã lưu ${records.length} trường ra CSV!`);
    }
  };

  const handleExportExcel = async (fieldsToExport: ExtractedField[]) => {
    const records = fieldsToExport.map((f, idx) => ({
      'STT': idx + 1,
      'Thẻ HTML': f.tagName,
      'Loại': f.type,
      'Tên (name)': f.name,
      'ID (id)': f.elementId,
      'Giá trị (value)': f.value,
      'Placeholder': f.placeholder,
      'Bắt buộc': f.required ? 'Có' : 'Không',
      'Form #': f.formIndex !== null ? `Form ${f.formIndex + 1}` : 'Độc lập'
    }));
    const saved = await exportToExcel(records, `html_fields_${Date.now()}.xlsx`, 'Trường HTML');
    if (saved) {
      showToast(`✓ Đã lưu ${records.length} trường ra Excel (.xlsx)!`);
    }
  };

  const handleApplyToRequestBody = (fieldsToApply: ExtractedField[], targetType: 'urlencoded' | 'formdata' | 'params') => {
    if (!activeTab) return;

    if (targetType === 'urlencoded') {
      const rows: KeyValueRow[] = fieldsToApply
        .filter(f => f.name || f.elementId)
        .map(f => ({
          id: Math.random().toString(36).substring(2, 9),
          key: f.name || f.elementId,
          value: f.value,
          enabled: true,
          description: f.type === 'hidden' ? 'Hidden token từ HTML' : undefined
        }));
      updateActiveTab({
        bodyType: 'urlencoded',
        urlEncodedList: rows
      });
      showToast(`✓ Đã điền ${rows.length} trường vào Request Body (URL-Encoded)!`);
    } else if (targetType === 'formdata') {
      const rows: FormDataRow[] = fieldsToApply
        .filter(f => f.name || f.elementId)
        .map(f => ({
          id: Math.random().toString(36).substring(2, 9),
          key: f.name || f.elementId,
          value: f.value,
          type: 'text',
          enabled: true,
          description: f.type === 'hidden' ? 'Hidden token từ HTML' : undefined
        }));
      updateActiveTab({
        bodyType: 'formdata',
        formDataList: rows
      });
      showToast(`✓ Đã điền ${rows.length} trường vào Request Body (Form Data)!`);
    } else if (targetType === 'params') {
      const rows: ParamPair[] = fieldsToApply
        .filter(f => f.name || f.elementId)
        .map(f => ({
          id: Math.random().toString(36).substring(2, 9),
          key: f.name || f.elementId,
          value: f.value,
          enabled: true,
          description: undefined
        }));
      updateActiveTab({
        paramsList: rows
      });
      showToast(`✓ Đã điền ${rows.length} trường vào Query Params!`);
    }
  };

  const filterPredicate = (f: ExtractedField) => {
    const term = (searchTerm || '').toLowerCase().trim();
    const name = (f.name || '').toLowerCase();
    const val = (f.value || '').toLowerCase();
    const elemId = (f.elementId || '').toLowerCase();
    const fType = (f.type || '').toLowerCase();

    const matchesSearch = !term ||
      name.includes(term) ||
      val.includes(term) ||
      elemId.includes(term) ||
      fType.includes(term);

    if (!matchesSearch) return false;

    if (filterType === 'hidden') return f.type === 'hidden';
    if (filterType === 'text') return ['text', 'password', 'email', 'number', 'tel', 'url', 'textarea'].includes(f.type);
    if (filterType === 'select') return f.type === 'select';
    if (filterType === 'choice') return ['checkbox', 'radio'].includes(f.type);

    return true;
  };

  const filteredAllFields = summary.allFields.filter(filterPredicate);

  const getTypeBadge = (type: string) => {
    let bg = 'rgba(56, 189, 248, 0.15)';
    let color = '#38bdf8';
    let icon = '✍️';

    switch (type) {
      case 'hidden':
        bg = 'rgba(168, 85, 247, 0.2)';
        color = '#c084fc';
        icon = '🔒';
        break;
      case 'password':
        bg = 'rgba(239, 68, 68, 0.2)';
        color = '#f87171';
        icon = '🔑';
        break;
      case 'select':
        bg = 'rgba(16, 185, 129, 0.2)';
        color = '#34d399';
        icon = '🔽';
        break;
      case 'checkbox':
      case 'radio':
        bg = 'rgba(245, 158, 11, 0.2)';
        color = '#fbbf24';
        icon = '☑️';
        break;
      case 'textarea':
        bg = 'rgba(99, 102, 241, 0.2)';
        color = '#818cf8';
        icon = '📜';
        break;
      case 'submit':
      case 'button':
        bg = 'rgba(14, 165, 233, 0.2)';
        color = '#38bdf8';
        icon = '🚀';
        break;
      case 'email':
      case 'number':
      case 'date':
        bg = 'rgba(20, 184, 166, 0.2)';
        color = '#2dd4bf';
        icon = '🔢';
        break;
      default:
        break;
    }

    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 7px',
        borderRadius: '5px',
        fontSize: '10.5px',
        fontWeight: 700,
        background: bg,
        color: color,
        border: `1px solid ${color}44`,
        fontFamily: 'var(--font-mono)'
      }}>
        <span>{icon}</span>
        <span>{type}</span>
      </span>
    );
  };

  if (summary.totalFieldsCount === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '40px 20px',
        color: 'var(--text-dim)',
        background: 'var(--bg-app)'
      }}>
        <span style={{ fontSize: '38px', opacity: 0.6 }}>🔍</span>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>
          Không tìm thấy trường nhập liệu trong tài liệu HTML
        </div>
        <div style={{ fontSize: '12px', maxWidth: '420px', textAlign: 'center', lineHeight: 1.5 }}>
          Phản hồi HTML này không chứa các thẻ form hoặc trường nhập liệu (<code>&lt;form&gt;</code>, <code>&lt;input&gt;</code>, <code>&lt;select&gt;</code>, <code>&lt;textarea&gt;</code>).
        </div>
      </div>
    );
  }

  const renderFieldsTable = (fields: ExtractedField[]) => {
    if (fields.length === 0) {
      return (
        <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
          Không có trường nào khớp với bộ lọc
        </div>
      );
    }

    return (
      <div style={{ overflowX: 'auto', width: '100%' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '12px',
          textAlign: 'left'
        }}>
          <thead>
            <tr style={{
              background: 'var(--bg-surface-secondary)',
              color: 'var(--text-dim)',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              borderBottom: '1px solid var(--border-card)'
            }}>
              <th style={{ padding: '8px 12px', width: '40px', textAlign: 'center' }}>#</th>
              <th style={{ padding: '8px 12px', width: '22%' }}>Tên trường (name)</th>
              <th style={{ padding: '8px 12px', width: '15%' }}>Loại (type)</th>
              <th style={{ padding: '8px 12px', width: '38%' }}>Giá trị hiện tại (value)</th>
              <th style={{ padding: '8px 12px', width: '15%' }}>Thuộc tính phụ</th>
              <th style={{ padding: '8px 12px', width: '10%', textAlign: 'center' }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, idx) => {
              const isLongValue = field.value && field.value.length > 50;
              const isExpanded = expandedValueId === field.id;
              const displayVal = isLongValue && !isExpanded
                ? `${field.value.substring(0, 48)}...`
                : field.value;

              return (
                <tr
                  key={field.id}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    background: idx % 2 === 0 ? 'transparent' : 'var(--bg-card-hover)',
                    transition: 'background 0.1s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-active)'}
                  onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'var(--bg-card-hover)'}
                >
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    {idx + 1}
                  </td>

                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        color: field.name ? 'var(--text-main)' : 'var(--text-muted)',
                        fontSize: '12px'
                      }}>
                        {field.name || (field.elementId ? `#${field.elementId}` : <em style={{ color: 'var(--text-dim)' }}>(không có tên)</em>)}
                      </span>
                      {field.name && (
                        <button
                          onClick={() => handleCopyText(field.name, `tên "${field.name}"`)}
                          title="Sao chép tên trường"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-dim)',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: '11px',
                            borderRadius: '3px'
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-primary)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
                        >
                          📋
                        </button>
                      )}
                    </div>
                  </td>

                  <td style={{ padding: '8px 12px' }}>
                    {getTypeBadge(field.type)}
                  </td>

                  <td style={{ padding: '8px 12px' }}>
                    {field.value ? (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                        <div style={{
                          flex: 1,
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11.5px',
                          color: field.type === 'hidden' ? 'var(--text-main)' : 'var(--color-primary)',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-card)',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          wordBreak: 'break-all',
                          maxHeight: isExpanded ? '180px' : 'auto',
                          overflowY: isExpanded ? 'auto' : 'hidden'
                        }}>
                          {displayVal}
                          {isLongValue && (
                            <button
                              onClick={() => setExpandedValueId(isExpanded ? null : field.id)}
                              style={{
                                display: 'inline-block',
                                marginLeft: '6px',
                                background: 'transparent',
                                border: 'none',
                                color: '#a855f7',
                                cursor: 'pointer',
                                fontSize: '10.5px',
                                fontWeight: 700,
                                textDecoration: 'underline'
                              }}
                            >
                              {isExpanded ? '▲ Thu gọn' : `▼ Xem hết (${field.value.length} ký tự)`}
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => handleCopyText(field.value, 'giá trị')}
                          title="Sao chép giá trị"
                          style={{
                            background: 'var(--bg-badge)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '4px',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            fontSize: '11px',
                            flexShrink: 0
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-primary)'; e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                        >
                          📋
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '11px' }}>
                        (giá trị trống)
                      </span>
                    )}

                    {field.options && field.options.length > 0 && (
                      <div style={{ marginTop: '4px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                        Tùy chọn: {field.options.map(o => o.value || o.label).join(', ')}
                      </div>
                    )}
                  </td>

                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {field.elementId && (
                        <span style={{ fontSize: '10px', background: 'var(--bg-badge)', padding: '1px 5px', borderRadius: '3px', color: 'var(--text-muted)' }}>
                          id: {field.elementId}
                        </span>
                      )}
                      {field.required && (
                        <span style={{ fontSize: '10px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
                          required
                        </span>
                      )}
                      {field.readonly && (
                        <span style={{ fontSize: '10px', background: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', padding: '1px 5px', borderRadius: '3px' }}>
                          readonly
                        </span>
                      )}
                      {field.disabled && (
                        <span style={{ fontSize: '10px', background: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', padding: '1px 5px', borderRadius: '3px' }}>
                          disabled
                        </span>
                      )}
                      {field.placeholder && (
                        <span style={{ fontSize: '10px', color: 'var(--text-dim)' }} title={field.placeholder}>
                          hint: {field.placeholder.substring(0, 16)}...
                        </span>
                      )}
                    </div>
                  </td>

                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <button
                      onClick={() => {
                        if (!activeTab) return;
                        const newRow: KeyValueRow = {
                          id: Math.random().toString(36).substring(2, 9),
                          key: field.name || field.elementId,
                          value: field.value,
                          enabled: true,
                          description: field.type === 'hidden' ? 'Hidden token từ HTML' : undefined
                        };
                        updateActiveTab({
                          bodyType: 'urlencoded',
                          urlEncodedList: [...activeTab.urlEncodedList, newRow]
                        });
                        showToast(`✓ Đã thêm "${field.name}" vào Request Body!`);
                      }}
                      title="Thêm riêng trường này vào Request Body (URL-Encoded)"
                      style={{
                        padding: '3px 8px',
                        background: 'rgba(56, 189, 248, 0.1)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        borderRadius: '4px',
                        color: '#38bdf8',
                        fontSize: '10.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.25)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'}
                    >
                      + Vào Body
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-app)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Toast Alert */}
      {toastMessage && (
        <div style={{
          position: 'absolute',
          top: '12px',
          right: '16px',
          zIndex: 100,
          background: '#10b981',
          color: '#0b0f17',
          padding: '6px 14px',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: 700,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          animation: 'fadeIn 0.2s ease'
        }}>
          {toastMessage}
        </div>
      )}

      {/* Header Metric Cards */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-card)',
        background: 'var(--bg-surface-secondary)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        flexShrink: 0
      }}>
        {/* Left Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            padding: '3px 8px',
            borderRadius: '5px'
          }}>
            <span style={{ fontSize: '12px' }}>📋</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Tổng:</span>
            <strong style={{ fontSize: '12px', color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
              {summary.totalFieldsCount}
            </strong>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(168, 85, 247, 0.1)',
            border: '1px solid rgba(168, 85, 247, 0.25)',
            padding: '3px 8px',
            borderRadius: '5px'
          }}>
            <span style={{ fontSize: '12px' }}>🔒</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Ẩn (Token/CSRF):</span>
            <strong style={{ fontSize: '12px', color: '#c084fc', fontFamily: 'var(--font-mono)' }}>
              {summary.hiddenFieldsCount}
            </strong>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            padding: '3px 8px',
            borderRadius: '5px'
          }}>
            <span style={{ fontSize: '12px' }}>📦</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Forms:</span>
            <strong style={{ fontSize: '12px', color: '#34d399', fontFamily: 'var(--font-mono)' }}>
              {summary.formsCount}
            </strong>
          </div>
        </div>

        {/* Global Batch Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleCopyAllJson(filteredAllFields)}
            title="Sao chép toàn bộ trường đang hiển thị dạng JSON"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'var(--bg-badge)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-main)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
          >
            <span>📄</span>
            <span>Chép JSON</span>
          </button>

          <button
            onClick={() => handleCopyAllUrlEncoded(filteredAllFields)}
            title="Sao chép toàn bộ trường dạng chuỗi key=val&..."
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'var(--bg-badge)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-main)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
          >
            <span>🔗</span>
            <span>Chép Form-URL</span>
          </button>

          <button
            onClick={() => handleExportJson(filteredAllFields)}
            title="Tải toàn bộ trường ra file JSON"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              color: '#34d399',
              cursor: 'pointer'
            }}
          >
            <span>📄</span>
            <span>Tải JSON</span>
          </button>

          <button
            onClick={() => handleExportCsv(filteredAllFields)}
            title="Tải toàn bộ trường ra file CSV (UTF-8)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              color: '#fbbf24',
              cursor: 'pointer'
            }}
          >
            <span>📊</span>
            <span>Tải CSV</span>
          </button>

          <button
            onClick={() => handleExportExcel(filteredAllFields)}
            title="Tải toàn bộ trường ra file Excel (.xlsx)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              color: '#22c55e',
              cursor: 'pointer'
            }}
          >
            <span>📗</span>
            <span>Tải Excel</span>
          </button>

          <button
            onClick={() => handleApplyToRequestBody(filteredAllFields, 'urlencoded')}
            title="Đưa tất cả các trường đang hiển thị vào tab Body (x-www-form-urlencoded) của Request hiện tại"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 9px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 700,
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.2) 0%, rgba(56, 189, 248, 0.3) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.5)',
              color: '#38bdf8',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.35)'}
            onMouseLeave={e => e.currentTarget.style.background = 'linear-gradient(135deg, rgba(14, 165, 233, 0.2) 0%, rgba(56, 189, 248, 0.3) 100%)'}
          >
            <span>⚡</span>
            <span>Đưa vào Body (URL-Encoded)</span>
          </button>

          <button
            onClick={() => handleApplyToRequestBody(filteredAllFields, 'formdata')}
            title="Đưa tất cả các trường vào Request Body dạng Multipart Form-Data"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid rgba(168, 85, 247, 0.35)',
              color: '#c084fc',
              cursor: 'pointer'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.25)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'}
          >
            <span>📦</span>
            <span>Form Data</span>
          </button>
        </div>
      </div>

      {/* Toolbar: Search, Type filter, Grouping switch */}
      <div style={{
        padding: '6px 14px',
        borderBottom: '1px solid var(--border-card)',
        background: 'var(--bg-surface-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        flexWrap: 'wrap',
        flexShrink: 0
      }}>
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px', maxWidth: '360px' }}>
          <input
            type="text"
            placeholder="🔍 Tìm theo tên, ID, giá trị..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: '11.5px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-card)',
              borderRadius: '5px',
              color: 'var(--text-main)',
              outline: 'none'
            }}
          />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: 'var(--bg-input)', padding: '2px', borderRadius: '5px', border: '1px solid var(--border-card)' }}>
            <button
              onClick={() => setFilterType('all')}
              style={{
                padding: '2px 7px',
                fontSize: '11px',
                borderRadius: '4px',
                background: filterType === 'all' ? 'var(--color-primary)' : 'transparent',
                color: filterType === 'all' ? '#ffffff' : 'var(--text-muted)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Tất cả ({summary.totalFieldsCount})
            </button>
            <button
              onClick={() => setFilterType('hidden')}
              style={{
                padding: '2px 7px',
                fontSize: '11px',
                borderRadius: '4px',
                background: filterType === 'hidden' ? '#c084fc' : 'transparent',
                color: filterType === 'hidden' ? '#ffffff' : 'var(--text-muted)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              🔒 Ẩn / Token ({summary.hiddenFieldsCount})
            </button>
            <button
              onClick={() => setFilterType('text')}
              style={{
                padding: '2px 7px',
                fontSize: '11px',
                borderRadius: '4px',
                background: filterType === 'text' ? 'var(--color-primary)' : 'transparent',
                color: filterType === 'text' ? '#ffffff' : 'var(--text-muted)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              ✍️ Text
            </button>
            <button
              onClick={() => setFilterType('select')}
              style={{
                padding: '2px 7px',
                fontSize: '11px',
                borderRadius: '4px',
                background: filterType === 'select' ? 'var(--color-primary)' : 'transparent',
                color: filterType === 'select' ? '#ffffff' : 'var(--text-muted)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              🔽 Select
            </button>
          </div>

          {summary.formsCount > 0 && (
            <div style={{ display: 'flex', background: 'var(--bg-input)', padding: '2px', borderRadius: '5px', border: '1px solid var(--border-card)' }}>
              <button
                onClick={() => setViewGrouping('forms')}
                style={{
                  padding: '2px 7px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  background: viewGrouping === 'forms' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: viewGrouping === 'forms' ? '#38bdf8' : 'var(--text-muted)',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Theo Form
              </button>
              <button
                onClick={() => setViewGrouping('flat')}
                style={{
                  padding: '2px 7px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  background: viewGrouping === 'flat' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: viewGrouping === 'flat' ? '#38bdf8' : 'var(--text-muted)',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Danh sách phẳng
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main List Area */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 14px 28px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        scrollBehavior: 'smooth'
      }}>
        {viewGrouping === 'forms' && summary.formsCount > 0 ? (
          <>
            {summary.forms.map((form, fIdx) => {
              const formFields = form.fields.filter(filterPredicate);
              return (
                <div
                  key={form.index}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                    flexShrink: 0
                  }}
                >
                  <div style={{
                    padding: '8px 12px',
                    background: 'var(--bg-surface-secondary)',
                    borderBottom: '1px solid var(--border-card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontSize: '10.5px',
                        fontWeight: 800,
                        background: form.method === 'POST' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                        color: form.method === 'POST' ? '#10b981' : '#38bdf8',
                        border: `1px solid ${form.method === 'POST' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.4)'}`
                      }}>
                        {form.method}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                        Form #{fIdx + 1}
                      </span>
                      {form.id && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          id="{form.id}"
                        </span>
                      )}
                      {form.action && (
                        <span style={{
                          fontSize: '11px',
                          color: '#38bdf8',
                          background: 'rgba(56, 189, 248, 0.08)',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontFamily: 'var(--font-mono)'
                        }}>
                          action: {form.action}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginRight: '2px' }}>
                        {formFields.length} trường
                      </span>
                      <button
                        onClick={() => handleCopyAllJson(formFields)}
                        title="Sao chép form này thành JSON"
                        style={{
                          padding: '3px 7px',
                          background: 'var(--bg-badge)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          color: 'var(--text-main)',
                          fontSize: '10.5px',
                          cursor: 'pointer'
                        }}
                      >
                        Chép Form
                      </button>
                      <button
                        onClick={() => handleApplyToRequestBody(formFields, 'urlencoded')}
                        title="Điền form này vào Request Body (URL-Encoded)"
                        style={{
                          padding: '3px 9px',
                          background: 'rgba(56, 189, 248, 0.15)',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          borderRadius: '4px',
                          color: '#38bdf8',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        ⚡ Điền vào Request
                      </button>
                    </div>
                  </div>

                  {renderFieldsTable(formFields)}
                </div>
              );
            })}

            {summary.standaloneFields.length > 0 && (
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: '8px',
                overflow: 'hidden',
                flexShrink: 0
              }}>
                <div style={{
                  padding: '8px 12px',
                  background: 'var(--bg-surface-secondary)',
                  borderBottom: '1px solid var(--border-card)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                    🌐 Các trường ngoài Form ({summary.standaloneFields.filter(filterPredicate).length} trường)
                  </span>
                  <button
                    onClick={() => handleApplyToRequestBody(summary.standaloneFields.filter(filterPredicate), 'urlencoded')}
                    style={{
                      padding: '3px 9px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: '4px',
                      color: '#38bdf8',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    ⚡ Điền vào Request
                  </button>
                </div>
                {renderFieldsTable(summary.standaloneFields.filter(filterPredicate))}
              </div>
            )}
          </>
        ) : (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: '8px',
            overflow: 'hidden',
            flexShrink: 0
          }}>
            {renderFieldsTable(filteredAllFields)}
          </div>
        )}
      </div>
    </div>
  );
}
