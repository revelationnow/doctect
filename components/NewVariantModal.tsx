
import React, { useState, useMemo } from 'react';
import { X, Monitor, ToggleLeft, ToggleRight } from 'lucide-react';
import { PAGE_PRESETS } from '../constants/editor';

export interface NewVariantConfig {
  name: string;
  targetWidth: number;
  targetHeight: number;
  reflow: boolean;
}

interface NewVariantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (config: NewVariantConfig) => void;
  currentVariantName: string;
  /** Width of first template in the active variant (for default dimensions) */
  currentWidth: number;
  /** Height of first template in the active variant (for default dimensions) */
  currentHeight: number;
}

type PresetKey = string;

export const NewVariantModal: React.FC<NewVariantModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  currentVariantName,
  currentWidth,
  currentHeight,
}) => {
  const [name, setName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('custom');
  const [customWidth, setCustomWidth] = useState(currentWidth);
  const [customHeight, setCustomHeight] = useState(currentHeight);
  const [reflow, setReflow] = useState(true);

  // Detect current preset from dimensions
  const detectedPreset = useMemo(() => {
    for (const [key, preset] of Object.entries(PAGE_PRESETS)) {
      if (Math.abs(preset.w - currentWidth) < 1 && Math.abs(preset.h - currentHeight) < 1) {
        return key;
      }
    }
    return 'custom';
  }, [currentWidth, currentHeight]);

  // Group presets by category for the dropdown
  const presetGroups = useMemo(() => {
    const entries = Object.entries(PAGE_PRESETS);
    const groups: { label: string; items: { key: string; name: string }[] }[] = [];

    const paperKeys = ['a4', 'letter', 'legal', 'a5'];
    const paper = entries.filter(([k]) => paperKeys.includes(k));
    const devices = entries.filter(([k]) => !paperKeys.includes(k));

    if (paper.length > 0) {
      groups.push({ label: 'Standard Paper', items: paper.map(([k, v]) => ({ key: k, name: `${v.name} (${v.w}×${v.h})` })) });
    }
    if (devices.length > 0) {
      groups.push({ label: 'Devices', items: devices.map(([k, v]) => ({ key: k, name: `${v.name} (${v.w}×${v.h})` })) });
    }
    return groups;
  }, []);

  // Resolved dimensions
  const resolvedWidth = selectedPreset === 'custom'
    ? customWidth
    : PAGE_PRESETS[selectedPreset]?.w ?? currentWidth;
  const resolvedHeight = selectedPreset === 'custom'
    ? customHeight
    : PAGE_PRESETS[selectedPreset]?.h ?? currentHeight;

  const dimensionsChanged = Math.abs(resolvedWidth - currentWidth) >= 1 || Math.abs(resolvedHeight - currentHeight) >= 1;

  // Reset state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setName(`${currentVariantName} (Copy)`);
      setSelectedPreset(detectedPreset);
      setCustomWidth(currentWidth);
      setCustomHeight(currentHeight);
      setReflow(true);
    }
  }, [isOpen, currentVariantName, currentWidth, currentHeight, detectedPreset]);

  if (!isOpen) return null;

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      targetWidth: resolvedWidth,
      targetHeight: resolvedHeight,
      reflow: reflow && dimensionsChanged,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Monitor size={18} className="text-indigo-500" />
            New Variant
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full text-slate-500">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Variant Name</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. iPad Version"
              autoFocus
            />
          </div>

          {/* Reflow Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border">
            <div>
              <div className="text-sm font-medium text-slate-700">Auto-Reflow Elements</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {reflow
                  ? 'Elements will be scaled proportionally to the new page size'
                  : 'Elements will keep their original positions and sizes'}
              </div>
            </div>
            <button
              onClick={() => setReflow(!reflow)}
              className="flex-shrink-0 ml-3 text-indigo-600"
              title={reflow ? 'Disable reflow' : 'Enable reflow'}
            >
              {reflow ? <ToggleRight size={28} /> : <ToggleLeft size={28} className="text-slate-400" />}
            </button>
          </div>

          {/* Page Size */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Page Size</label>
                <select
                  value={selectedPreset}
                  onChange={e => setSelectedPreset(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                >
                  <option value="custom">Custom</option>
                  {presetGroups.map(group => (
                    <optgroup key={group.label} label={group.label}>
                      {group.items.map(item => (
                        <option key={item.key} value={item.key}>{item.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Custom dimensions */}
              {selectedPreset === 'custom' && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Width (pt)</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={customWidth}
                      onChange={e => setCustomWidth(parseFloat(e.target.value) || 0)}
                      min={50}
                      step={1}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Height (pt)</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={customHeight}
                      onChange={e => setCustomHeight(parseFloat(e.target.value) || 0)}
                      min={50}
                      step={1}
                    />
                  </div>
                </div>
              )}

              {/* Dimensions summary */}
              <div className="text-xs text-slate-500 bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 flex items-center justify-between">
                <span>
                  <span className="font-medium text-slate-600">Current:</span> {currentWidth} × {currentHeight} pt
                </span>
                <span className="text-indigo-600 font-medium">→</span>
                <span>
                  <span className="font-medium text-slate-600">New:</span> {resolvedWidth} × {resolvedHeight} pt
                </span>
              </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            Create Variant
          </button>
        </div>
      </div>
    </div>
  );
};
