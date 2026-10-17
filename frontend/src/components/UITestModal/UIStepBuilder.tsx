import React, { useState, useEffect } from 'react';
import { main } from '../../../wailsjs/go/models';

interface UIStepBuilderProps {
  step: main.DBUIStep | null;
  onSave: (step: main.DBUIStep) => void;
  onCancel: () => void;
  stepIndex: number;
}

const STEP_TYPES = [
  // Actions
  { group: 'Browser Actions', value: 'navigate', label: '🌐 Navigate to URL' },
  { group: 'Browser Actions', value: 'click', label: '👆 Click Element' },
  { group: 'Browser Actions', value: 'dblclick', label: '🖱️ Double Click' },
  { group: 'Browser Actions', value: 'input', label: '⌨️ Input Text / Fill' },
  { group: 'Browser Actions', value: 'clear', label: '🧹 Clear Input' },
  { group: 'Browser Actions', value: 'select', label: '🔽 Select Option' },
  { group: 'Browser Actions', value: 'check', label: '☑️ Check Checkbox/Radio' },
  { group: 'Browser Actions', value: 'uncheck', label: '⬜ Uncheck Checkbox' },
  { group: 'Browser Actions', value: 'hover', label: '🎯 Hover Mouse' },
  { group: 'Browser Actions', value: 'scroll', label: '📜 Scroll into View' },
  { group: 'Browser Actions', value: 'press_key', label: '🔘 Press Keyboard Key' },
  { group: 'Browser Actions', value: 'upload_file', label: '📁 Upload File' },
  { group: 'Browser Actions', value: 'wait', label: '⏳ Wait / Delay' },

  // Assertions
  { group: 'Assertions', value: 'assert_element_exists', label: '🔍 Assert Element Exists' },
  { group: 'Assertions', value: 'assert_element_visible', label: '👁️ Assert Element Visible' },
  { group: 'Assertions', value: 'assert_element_enabled', label: '⚡ Assert Element Enabled' },
  { group: 'Assertions', value: 'assert_text', label: '📝 Assert Element Text' },
  { group: 'Assertions', value: 'assert_value', label: '🏷️ Assert Input Value' },
  { group: 'Assertions', value: 'assert_attribute', label: '⚙️ Assert HTML Attribute' },
  { group: 'Assertions', value: 'assert_url', label: '🔗 Assert Current URL' },
  { group: 'Assertions', value: 'assert_title', label: '📑 Assert Page Title' },
];

export default function UIStepBuilder({
  step,
  onSave,
  onCancel,
  stepIndex
}: UIStepBuilderProps) {
  const [type, setType] = useState<string>('navigate');
  const [selector, setSelector] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [timeout, setTimeoutVal] = useState<number>(5000);

  // Config JSON values
  const [operator, setOperator] = useState<string>('contains');
  const [attributeName, setAttributeName] = useState<string>('value');
  const [keyName, setKeyName] = useState<string>('Enter');
  const [waitState, setWaitState] = useState<string>('visible');
  const [scrollX, setScrollX] = useState<number>(0);
  const [scrollY, setScrollY] = useState<number>(500);

  useEffect(() => {
    if (step) {
      setType(step.type || 'navigate');
      setSelector(step.selector || '');
      setValue(step.value || '');
      setTimeoutVal(step.timeout || 5000);

      try {
        if (step.configJson && step.configJson !== '{}') {
          const cfg = JSON.parse(step.configJson);
          if (cfg.operator) setOperator(cfg.operator);
          if (cfg.attributeName) setAttributeName(cfg.attributeName);
          if (cfg.keyName) setKeyName(cfg.keyName);
          if (cfg.waitState) setWaitState(cfg.waitState);
          if (cfg.scrollX !== undefined) setScrollX(cfg.scrollX);
          if (cfg.scrollY !== undefined) setScrollY(cfg.scrollY);
        }
      } catch (e) {
        // ignore
      }
    } else {
      setType('navigate');
      setSelector('');
      setValue('');
      setTimeoutVal(5000);
      setOperator('contains');
      setAttributeName('value');
      setKeyName('Enter');
      setWaitState('visible');
    }
  }, [step]);

  const handleSave = () => {
    const configObj: Record<string, any> = {};

    if (type.startsWith('assert_') || type === 'assert_url' || type === 'assert_title') {
      configObj.operator = operator;
    }
    if (type === 'assert_attribute') {
      configObj.attributeName = attributeName;
    }
    if (type === 'press_key') {
      configObj.keyName = keyName;
    }
    if (type === 'wait') {
      configObj.waitState = waitState;
    }
    if (type === 'scroll' && !selector.trim()) {
      configObj.scrollX = scrollX;
      configObj.scrollY = scrollY;
    }

    const updatedStep = new main.DBUIStep({
      id: step?.id || `step_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      scenarioId: step?.scenarioId || '',
      sortOrder: step?.sortOrder || stepIndex + 1,
      type: type,
      selector: selector.trim(),
      value: value.trim(),
      timeout: timeout || 5000,
      configJson: JSON.stringify(configObj),
    });

    onSave(updatedStep);
  };

  const isAssertion = type.startsWith('assert_');

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: '8px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            background: isAssertion ? 'rgba(168, 85, 247, 0.15)' : 'rgba(56, 189, 248, 0.15)',
            color: isAssertion ? '#c084fc' : 'var(--color-primary)',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)'
          }}>
            Step {stepIndex + 1}
          </span>
          <span>{step ? 'Edit UI Step' : 'Add New UI Step'}</span>
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Supports <code style={{ color: 'var(--color-primary)' }}>&#123;&#123;variable&#125;&#125;</code>
        </span>
      </div>

      {/* Row 1: Step Type & Timeout */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Step Action / Assertion</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{
              padding: '7px 10px',
              borderRadius: '6px',
              background: 'var(--bg-input)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-card)',
              fontSize: '12px',
              fontWeight: 600
            }}
          >
            <optgroup label="Browser Actions">
              {STEP_TYPES.filter((s) => s.group === 'Browser Actions').map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </optgroup>
            <optgroup label="Assertions">
              {STEP_TYPES.filter((s) => s.group === 'Assertions').map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </optgroup>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Timeout (ms)</label>
          <input
            type="number"
            min={100}
            step={500}
            value={timeout}
            onChange={(e) => setTimeoutVal(Number(e.target.value))}
            style={{
              padding: '7px 10px',
              borderRadius: '6px',
              background: 'var(--bg-input)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-card)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)'
            }}
          />
        </div>
      </div>

      {/* Dynamic Fields depending on Step Type */}
      {/* 1. Navigate */}
      {type === 'navigate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Target URL / Path (e.g. <code>https://example.com/login</code> or <code>/dashboard</code>)
          </label>
          <input
            type="text"
            placeholder="https://example.com/login or {{base_url}}/login"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'var(--bg-input)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-card)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)'
            }}
          />
        </div>
      )}

      {/* 2. Selector-based Actions (Click, DblClick, Input, Select, Check, etc.) */}
      {type !== 'navigate' && type !== 'assert_url' && type !== 'assert_title' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
            CSS / XPath / Text Selector (e.g. <code>#login-btn</code>, <code>button:has-text("Submit")</code>)
          </label>
          <input
            type="text"
            placeholder="#username, .btn-primary, [data-testid='login-btn'], text=Sign In"
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'var(--bg-input)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-card)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)'
            }}
          />
        </div>
      )}

      {/* 3. Input Text / Select / File / Key Value */}
      {(type === 'input' || type === 'select' || type === 'upload_file') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
            {type === 'input' ? 'Input Text / Value' : type === 'select' ? 'Option Value or Label' : 'File Path'}
          </label>
          <input
            type="text"
            placeholder={type === 'input' ? 'Enter text or {{username}}' : type === 'select' ? 'option-value' : 'C:/files/sample.pdf'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'var(--bg-input)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-card)',
              fontSize: '12px'
            }}
          />
        </div>
      )}

      {/* 4. Press Key */}
      {type === 'press_key' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Key to Press</label>
            <input
              type="text"
              placeholder="Enter, Tab, Escape, ArrowDown, Control+A"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'var(--bg-input)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-card)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)'
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Target (optional)</label>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px' }}>
              Leaves body focused if selector is empty
            </span>
          </div>
        </div>
      )}

      {/* 5. Wait */}
      {type === 'wait' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Delay Milliseconds</label>
            <input
              type="number"
              placeholder="1000"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'var(--bg-input)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-card)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)'
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Selector Wait State</label>
            <select
              value={waitState}
              onChange={(e) => setWaitState(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'var(--bg-input)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-card)',
                fontSize: '12px'
              }}
            >
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
              <option value="attached">Attached in DOM</option>
              <option value="detached">Detached from DOM</option>
            </select>
          </div>
        </div>
      )}

      {/* 6. Assertions (Text, Value, Attribute, URL, Title) */}
      {(type === 'assert_text' || type === 'assert_value' || type === 'assert_attribute' || type === 'assert_url' || type === 'assert_title') && (
        <div style={{ display: 'grid', gridTemplateColumns: type === 'assert_attribute' ? '1fr 1fr 2fr' : '1fr 2fr', gap: '10px' }}>
          {type === 'assert_attribute' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Attribute Name</label>
              <input
                type="text"
                placeholder="href, src, disabled, class"
                value={attributeName}
                onChange={(e) => setAttributeName(e.target.value)}
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  background: 'var(--bg-input)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-card)',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)'
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Comparison Operator</label>
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'var(--bg-input)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-card)',
                fontSize: '12px'
              }}
            >
              <option value="contains">Contains</option>
              <option value="equals">Equals (Exact)</option>
              <option value="starts_with">Starts With</option>
              <option value="ends_with">Ends With</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Expected Value</label>
            <input
              type="text"
              placeholder="Expected text, substring or {{variable}}"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'var(--bg-input)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-card)',
                fontSize: '12px'
              }}
            />
          </div>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            background: 'var(--bg-active)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-card)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          style={{
            padding: '6px 16px',
            borderRadius: '6px',
            background: 'var(--color-primary)',
            color: '#ffffff',
            border: 'none',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>✓</span> {step ? 'Update Step' : 'Save Step'}
        </button>
      </div>
    </div>
  );
}
