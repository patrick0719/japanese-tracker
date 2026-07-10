import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import QRCode from 'qrcode';
import './index.css';
import { t } from './translations';
import { usePushNotifications } from './usePushNotifications';
import {
  TrendingUp, TrendingDown, Minus, User, Building2, FileText, BarChart2,
  Trophy, Target, Flame, Rocket, AlertTriangle, Zap, Star, MapPin,
  Clock, Folder, Camera, CheckCircle, Loader, Image, File, Layers,
  Users, Grid, Eye, EyeOff, KeyRound, RefreshCw, Lock, Sun, Moon,
  Settings, X, ChevronLeft, ChevronRight, Search, AlertCircle, Flag,
  BookOpen, Trash2, MoreHorizontal, ArrowLeft, Check, Plus, ArrowRightLeft, PenLine, SlidersHorizontal, MoreVertical
} from 'lucide-react';
import jsQR from 'jsqr';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { NotFoundException } from '@zxing/library';
import bwipjs from 'bwip-js';

// Returns correct name based on role — JA for kumiai, EN for admin/PHGIC
function displayName(item) {
  try {
    const role = localStorage.getItem('sage_role') || 'admin';
    if (['setouchi','wbc','gyoumusuishin','greenservices'].includes(role) && item?.name_ja) return item.name_ja;
  } catch {}
  return item?.name || '';
}

// Apply or remove dark mode on <html>
function applyDarkMode(dark) {
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

const API = 'https://japanese-tracker-production.up.railway.app/api';
// TODO: set REACT_APP_CLOUDINARY_CLOUD and REACT_APP_CLOUDINARY_PRESET in your .env file
const CLOUDINARY_CLOUD = process.env.REACT_APP_CLOUDINARY_CLOUD || 'daofbq9wz';
const CLOUDINARY_PRESET = process.env.REACT_APP_CLOUDINARY_PRESET || 'cnbztuzc';

// Safe localStorage helper — returns null on SecurityError (e.g. private/incognito mode)
function safeLocalGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLocalSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function safeLocalRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}


// Compress image before sending to backend
const compressImage = (file, maxWidth = 800, quality = 0.6) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img'); // avoid new Image() minification conflict
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};

// ── IMAGE VIEWER COMPONENT ──────────────────────────────────────────────────
function ImageViewer({ images, startIndex, onClose }) {
  const [current, setCurrent] = useState(startIndex || 0);

  // ── Pinch-zoom-snap state ─────────────────────────────────────────────────
  // scale: current live zoom level while fingers are down
  // When fingers lift → animate back to scale=1 instantly (snap back)
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 }); // transform-origin in %
  const isPinching = useRef(false);
  const initialDist = useRef(null);
  const initialMid = useRef({ x: 0, y: 0 });
  const imgRef = useRef(null);

  // Swipe state (only when NOT pinching)
  const swipeStartX = useRef(null);

  const prev = () => { if (scale === 1) setCurrent(i => Math.max(0, i - 1)); };
  const next = () => { if (scale === 1) setCurrent(i => Math.min(images.length - 1, i + 1)); };

  // Reset zoom when image changes
  useEffect(() => { setScale(1); setOrigin({ x: 50, y: 50 }); }, [current]);

  // Keyboard nav
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, scale]);

  // ── Touch handlers ────────────────────────────────────────────────────────
  const getDist = (t) => {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  };

  const getMid = (t, rect) => ({
    x: ((t[0].clientX + t[1].clientX) / 2 - rect.left) / rect.width * 100,
    y: ((t[0].clientY + t[1].clientY) / 2 - rect.top) / rect.height * 100,
  });

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      // Pinch start
      isPinching.current = true;
      swipeStartX.current = null;
      initialDist.current = getDist(e.touches);
      const rect = imgRef.current?.getBoundingClientRect() || { left: 0, top: 0, width: 1, height: 1 };
      initialMid.current = getMid(e.touches, rect);
    } else if (e.touches.length === 1 && !isPinching.current) {
      swipeStartX.current = e.touches[0].clientX;
    }
  };

  const onTouchMove = (e) => {
    if (e.touches.length === 2 && initialDist.current) {
      e.preventDefault();
      const newDist = getDist(e.touches);
      const raw = newDist / initialDist.current;
      // Clamp scale: 1x minimum (no pinch-in below normal), 4x max
      const clamped = Math.min(4, Math.max(1, raw));
      setScale(clamped);
      setOrigin(initialMid.current);
    }
  };

  const onTouchEnd = (e) => {
    if (isPinching.current) {
      // Snap back to normal on finger lift
      setScale(1);
      setOrigin({ x: 50, y: 50 });
      isPinching.current = false;
      initialDist.current = null;
      swipeStartX.current = null;
      return;
    }
    // Single-finger swipe for page navigation
    if (swipeStartX.current !== null && e.changedTouches.length > 0) {
      const diff = swipeStartX.current - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) { diff > 0 ? next() : prev(); }
      swipeStartX.current = null;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer, ${images.length} pages`}
      style={{
        position: 'fixed', inset: 0, background: '#000', zIndex: 9999,
        display: 'flex', flexDirection: 'column',
        // Block native browser pinch-zoom inside the viewer
        touchAction: 'none',
      }}
    >
      {/* Top bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 20px', background: 'rgba(0,0,0,0.8)', flexShrink: 0,
      }}>
        <button onClick={onClose} aria-label="Close image viewer" style={{
          background: 'none', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}><X size={24} strokeWidth={2.5} /></button>
        <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>
          Page {current + 1} / {images.length}
        </span>
        <div style={{ width: 32 }} />
      </div>

      {/* Image area */}
      <div
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', position: 'relative',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          ref={imgRef}
          src={images[current]}
          alt={`Page ${current + 1} of ${images.length}`}
          draggable={false}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            // Smooth snap-back when scale returns to 1, instant zoom while pinching
            transform: `scale(${scale})`,
            transformOrigin: `${origin.x}% ${origin.y}%`,
            transition: scale === 1 ? 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)' : 'none',
            willChange: 'transform',
          }}
        />

        {/* Zoom hint — only when not zoomed */}
        {scale === 1 && (
          <div style={{
            position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.55)',
            fontSize: 11, fontWeight: 500, padding: '4px 12px', borderRadius: 20,
            pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            Pinch to zoom · Release to snap back
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 24px', background: 'rgba(0,0,0,0.8)', flexShrink: 0,
      }}>
        <button
          onClick={prev}
          disabled={current === 0}
          aria-label="Previous page"
          style={{
            background: current === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)',
            color: '#fff', border: 'none', borderRadius: 10,
            padding: '10px 20px', fontSize: 18, cursor: current === 0 ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center'
          }}><ChevronLeft size={20} strokeWidth={2.5} /></button>

        {/* Dot indicators */}
        <div role="tablist" aria-label="Page navigation" style={{ display: 'flex', gap: 6 }}>
          {images.map((_, i) => (
            <div
              key={i}
              role="tab"
              aria-selected={i === current}
              aria-label={`Go to page ${i + 1}`}
              tabIndex={0}
              onClick={() => setCurrent(i)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setCurrent(i)}
              style={{
                width: i === current ? 20 : 8, height: 8,
                borderRadius: 4, background: i === current ? '#fff' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer', transition: 'all 0.2s'
              }} />
          ))}
        </div>

        <button
          onClick={next}
          disabled={current === images.length - 1}
          aria-label="Next page"
          style={{
            background: current === images.length - 1 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)',
            color: '#fff', border: 'none', borderRadius: 10,
            padding: '10px 20px', fontSize: 18, cursor: current === images.length - 1 ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center'
          }}><ChevronRight size={20} strokeWidth={2.5} /></button>
      </div>
    </div>
  );
}
// ── PROGRESS CHART COMPONENT ─────────────────────────────────────────────────
function ProgressChart({ student, batch, onClose }) {
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('all');
  const [selectedCategories, setSelectedCategories] = useState([]);

  const processChartData = useCallback(() => {
    setLoading(true);
    
    const allExams = [];
    const categories = new Set();

    // Compute cutoff dates ONCE — avoid mutating `now` across multiple calls
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    const oneMonthAgo   = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    
    (student.categories || []).forEach(cat => {
      categories.add(cat.name);
      (cat.items || []).forEach(item => {
        if (item.date && item.score != null && item.totalScore) {
          const date = new Date(item.date);
          const pct = (item.score / item.totalScore) * 100;
          
          let include = true;
          if (timeRange === '3months') {
            include = date >= threeMonthsAgo;
          } else if (timeRange === '1month') {
            include = date >= oneMonthAgo;
          }
          
          if (include && (selectedCategories.length === 0 || selectedCategories.includes(cat.name))) {
            allExams.push({
              date,
              dateStr: item.date,
              score: item.score,
              total: item.totalScore,
              percentage: Math.round(pct),
              category: cat.name,
              examName: item.name
            });
          }
        }
      });
    });
    
    allExams.sort((a, b) => a.date - b.date);
    
    const calculateTrend = (points) => {
      if (points.length < 2) return null;
      const n = points.length;
      const sumX = points.reduce((s, p, i) => s + i, 0);
      const sumY = points.reduce((s, p) => s + p.percentage, 0);
      const sumXY = points.reduce((s, p, i) => s + i * p.percentage, 0);
      const sumXX = points.reduce((s, p, i) => s + i * i, 0);
      
      const denom = n * sumXX - sumX * sumX;
      if (denom === 0) return null;
      const slope = (n * sumXY - sumX * sumY) / denom;
      const intercept = (sumY - slope * sumX) / n;
      
      return points.map((_, i) => slope * i + intercept);
    };
    
    const trend = calculateTrend(allExams);
    
    // ── Smart stats ──────────────────────────────────────────────────
    const n = allExams.length;
    const avg = n > 0 ? Math.round(allExams.reduce((s, e) => s + e.percentage, 0) / n) : 0;

    // Recent trend: avg of last 3 exams vs avg of previous 3 exams
    // More accurate than first-vs-last because it smooths outliers
    let recentTrend = null;
    let recentTrendLabel = '';
    if (n >= 2) {
      const window = Math.min(3, Math.floor(n / 2));
      const recentAvg = Math.round(
        allExams.slice(-window).reduce((s, e) => s + e.percentage, 0) / window
      );
      const prevAvg = Math.round(
        allExams.slice(-(window * 2), -window).reduce((s, e) => s + e.percentage, 0) / window
      );
      recentTrend = recentAvg - prevAvg;
      recentTrendLabel = `Last ${window} vs prev ${window}`;
    }

    // Improving streak: how many consecutive exams (from latest) have been going up
    let streak = 0;
    for (let i = n - 1; i > 0; i--) {
      if (allExams[i].percentage > allExams[i - 1].percentage) streak++;
      else break;
    }

    // Consistency: % of exams at or above the student's own average
    const consistency = n > 0
      ? Math.round((allExams.filter(e => e.percentage >= avg).length / n) * 100)
      : 0;

    const stats = {
      totalExams: n,
      avgScore: avg,
      bestScore: n > 0 ? Math.max(...allExams.map(e => e.percentage)) : 0,
      latestScore: n > 0 ? allExams[n - 1].percentage : 0,
      // Keep raw improvement for backward compat
      improvement: n > 1 ? allExams[n - 1].percentage - allExams[0].percentage : 0,
      // Smart metrics
      recentTrend,
      recentTrendLabel,
      streak,
      consistency,
    };
    
    setChartData({ exams: allExams, categories: Array.from(categories), trend, stats });
    setLoading(false);
  }, [student, timeRange, selectedCategories]);

  useEffect(() => {
    processChartData();
  }, [processChartData]);

  // Cleanup PTR refresh timer on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      if (ptrRefreshingRef._timer) clearTimeout(ptrRefreshingRef._timer);
      ptrRefreshingRef.current = false;
    };
  }, []);

  const renderChart = () => {
    if (!chartData || chartData.exams.length === 0) return null;
    
    const width = 340;
    const height = 220;
    const padding = { top: 20, right: 20, bottom: 40, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    const exams = chartData.exams;
    // When there's only 1 exam, centre it instead of pinning to x=0
    const scaleX = (i) => exams.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + (i / (exams.length - 1)) * chartWidth;
    const scaleY = (val) => padding.top + chartHeight - (val / 100) * chartHeight;
    
    const scorePath = exams.map((e, i) => {
      const x = scaleX(i);
      const y = scaleY(e.percentage);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
    
    const trendPath = chartData.trend?.map((t, i) => {
      const x = scaleX(i);
      const y = scaleY(t);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ') || '';
    
    const gridLines = [0, 25, 50, 75, 100].map(val => ({
      y: scaleY(val),
      label: val + '%'
    }));

    // Read CSS vars at render time so SVG respects dark mode
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartBg    = isDark ? '#2c2c2e' : '#f8f9fa';
    const gridStroke = isDark ? '#48484a' : '#e5e5ea';
    const labelFill  = isDark ? 'rgba(235,235,245,0.5)' : '#8e8e93';
    const dotFill    = isDark ? '#2c2c2e' : '#fff';

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: 400 }}>
        <rect x={padding.left} y={padding.top} width={chartWidth} height={chartHeight} fill={chartBg} rx={4} />
        
        {gridLines.map((line, i) => (
          <g key={i}>
            <line x1={padding.left} y1={line.y} x2={width - padding.right} y2={line.y} 
              stroke={gridStroke} strokeWidth={1} strokeDasharray="4,4" />
            <text x={padding.left - 8} y={line.y + 4} textAnchor="end" fontSize={10} fill={labelFill}>{line.label}</text>
          </g>
        ))}
        
        {trendPath && (
          <path d={trendPath} fill="none" stroke="#8B0000" strokeWidth={2} strokeDasharray="6,4" opacity={0.6} />
        )}
        
        <path d={scorePath} fill="none" stroke="#007AFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#007AFF" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#007AFF" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <path 
          d={`${scorePath} L ${scaleX(exams.length - 1)} ${scaleY(0)} L ${scaleX(0)} ${scaleY(0)} Z`}
          fill="url(#areaGradient)"
        />
        
        {exams.map((e, i) => (
          <g key={i}>
            <circle cx={scaleX(i)} cy={scaleY(e.percentage)} r={5} fill={dotFill} stroke="#007AFF" strokeWidth={2} />
            <title>{`${e.examName}\n${e.category}: ${e.score}/${e.total} (${e.percentage}%)\n${e.dateStr}`}</title>
          </g>
        ))}
        
        {exams.length <= 8 ? exams.map((e, i) => (
          <text key={i} x={scaleX(i)} y={height - 10} textAnchor="middle" fontSize={9} fill={labelFill} transform={`rotate(-45, ${scaleX(i)}, ${height - 10})`}>
            {e.dateStr.slice(5)}
          </text>
        )) : (() => {
          const step = Math.ceil(exams.length / 6);
          return exams
            .map((e, i) => ({ e, i }))
            .filter(({ i }) => i % step === 0)
            .map(({ e, i }) => (
              <text key={i} x={scaleX(i)} y={height - 10} textAnchor="middle" fontSize={9} fill={labelFill} transform={`rotate(-45, ${scaleX(i)}, ${height - 10})`}>
                {e.dateStr.slice(5)}
              </text>
            ));
        })()}
      </svg>
    );
  };

  const [ptrDist, setPtrDist] = useState(0);
  const [ptrTriggered, setPtrTriggered] = useState(false);
  const [ptrRefreshing, setPtrRefreshing] = useState(false);
  const ptrDistRef = useRef(0);
  const ptrTriggeredRef = useRef(false);
  const ptrRefreshingRef = useRef(false);
  const ptrStartY = useRef(null);
  const ptrScrollRef = useRef(null);
  const PTR_THRESHOLD = 80;

  const ptrTouchStart = (e) => {
    if (ptrRefreshingRef.current) return;
    if ((ptrScrollRef.current?.scrollTop ?? 0) > 0) { ptrStartY.current = null; return; }
    ptrStartY.current = e.touches[0].clientY;
  };
  const ptrTouchMove = (e) => {
    if (ptrStartY.current === null) return;
    if ((ptrScrollRef.current?.scrollTop ?? 0) > 0) {
      ptrStartY.current = null;
      setPtrDist(0); ptrDistRef.current = 0;
      setPtrTriggered(false); ptrTriggeredRef.current = false;
      return;
    }
    const dy = e.touches[0].clientY - ptrStartY.current;
    if (dy <= 0) { setPtrDist(0); ptrDistRef.current = 0; setPtrTriggered(false); ptrTriggeredRef.current = false; return; }
    const dist = Math.min(dy * 0.45, 120);
    setPtrDist(dist); ptrDistRef.current = dist;
    if (dist >= PTR_THRESHOLD && !ptrTriggeredRef.current) { setPtrTriggered(true); ptrTriggeredRef.current = true; }
    else if (dist < PTR_THRESHOLD && ptrTriggeredRef.current) { setPtrTriggered(false); ptrTriggeredRef.current = false; }
  };
  const ptrTouchEnd = () => {
    if (ptrDistRef.current >= PTR_THRESHOLD && !ptrRefreshingRef.current) {
      ptrStartY.current = null;
      setPtrDist(0); ptrDistRef.current = 0;
      setPtrTriggered(false); ptrTriggeredRef.current = false;
      setPtrRefreshing(true); ptrRefreshingRef.current = true;
      // re-process chart data (simulates refresh)
      const timer = setTimeout(() => {
        if (!ptrRefreshingRef.current) return; // guard: component may have unmounted
        processChartData();
        setPtrRefreshing(false);
        ptrRefreshingRef.current = false;
      }, 800);
      // store timer so it can be cleared on unmount
      ptrRefreshingRef._timer = timer;
    } else {
      ptrStartY.current = null;
      setPtrDist(0); ptrDistRef.current = 0;
      setPtrTriggered(false); ptrTriggeredRef.current = false;
    }
  };

  const toggleCategory = (cat) => {
    setSelectedCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-primary, #f2f2f7)', zIndex: 9999,
      display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #8B0000, #c0392b)',
        padding: '16px 20px',
        paddingTop: 'env(safe-area-inset-top, 16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
        boxShadow: '0 2px 12px rgba(139,0,0,0.3)'
      }}>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
          borderRadius: 10, padding: '8px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer'
        }}>{t('back')}</button>
        <span style={{ color: '#fff', fontSize: 18, fontWeight: 700, letterSpacing: -0.3, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={18} /> {t('progressChart')}</span>
        <div style={{ width: 72 }} />
      </div>

      <div style={{
        background: 'var(--bg-card, #fff)', padding: '16px 20px', borderBottom: '1px solid var(--border-color, #e5e5ea)',
        display: 'flex', alignItems: 'center', gap: 14
      }}>
        {student.photo ? (
          <img src={student.photo} alt={student.name} style={{
            width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid #8B0000'
          }} />
        ) : (
          <span style={{ fontSize: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'var(--bg-card2, #f2f2f7)', color: '#8e8e93' }}><User size={28} /></span>
        )}
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #1c1c1e)' }}>{student.name}</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-tertiary, #8e8e93)' }}>{batch?.name}</p>
          {student.companyName && (
            <span style={{
              display: 'inline-block', marginTop: 4,
              background: 'var(--green-soft, #e8f5e9)', color: 'var(--green, #2e7d32)',
              fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12
            }}><Building2 size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />{student.companyName}</span>
          )}
        </div>
      </div>

      <div
        ref={ptrScrollRef}
        onTouchStart={ptrTouchStart}
        onTouchMove={ptrTouchMove}
        onTouchEnd={ptrTouchEnd}
        style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', position: 'relative' }}
      >
        {/* PTR indicator */}
        {(ptrDist > 0 || ptrRefreshing) && (() => {
          const progress = Math.min(ptrDist / PTR_THRESHOLD, 1);
          const circleSize = 44; const radius = 16;
          const circumference = 2 * Math.PI * radius;
          const dashOffset = circumference * (1 - (ptrTriggered ? 1 : progress));
          return (
            <div style={{ position: 'sticky', top: 0, left: 0, right: 0, zIndex: 99, display: 'flex', justifyContent: 'center', paddingTop: 6, paddingBottom: 6, pointerEvents: 'none', marginTop: -20, marginBottom: 8 }}>
              <div style={{ width: circleSize, height: circleSize, borderRadius: '50%', background: ptrTriggered || ptrRefreshing ? 'linear-gradient(135deg,#8B0000,#c0392b)' : 'rgba(255,255,255,0.97)', boxShadow: ptrTriggered || ptrRefreshing ? '0 4px 20px rgba(139,0,0,0.4)' : '0 2px 14px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.65 + progress * 0.35})`, transition: 'background 0.2s, box-shadow 0.2s, transform 0.1s' }}>
                {ptrRefreshing ? (
                  <svg width={circleSize} height={circleSize} viewBox={`0 0 ${circleSize} ${circleSize}`} style={{ position: 'absolute', animation: 'ptr-spin 0.75s linear infinite' }}>
                    <circle cx={circleSize/2} cy={circleSize/2} r={radius} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
                    <circle cx={circleSize/2} cy={circleSize/2} r={radius} fill="none" stroke="#fff" strokeWidth="2.5" strokeDasharray={circumference} strokeDashoffset={circumference * 0.72} strokeLinecap="round" transform={`rotate(-90 ${circleSize/2} ${circleSize/2})`} />
                  </svg>
                ) : (
                  <svg width={circleSize} height={circleSize} viewBox={`0 0 ${circleSize} ${circleSize}`} style={{ position: 'absolute' }}>
                    <circle cx={circleSize/2} cy={circleSize/2} r={radius} fill="none" stroke="rgba(139,0,0,0.12)" strokeWidth="2.5" />
                    <circle cx={circleSize/2} cy={circleSize/2} r={radius} fill="none" stroke={ptrTriggered ? '#fff' : '#8B0000'} strokeWidth="2.5" strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round" transform={`rotate(-90 ${circleSize/2} ${circleSize/2})`} style={{ transition: 'stroke-dashoffset 0.06s, stroke 0.2s' }} />
                  </svg>
                )}
                <svg width="16" height="16" viewBox="0 0 16 16" style={{ position: 'relative', zIndex: 1, transform: `rotate(${ptrTriggered || ptrRefreshing ? 180 : progress * 200}deg)`, transition: ptrTriggered ? 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)' : 'transform 0.1s' }}>
                  <path d="M8 2 L8 11 M4 7 L8 11 L12 7" stroke={ptrTriggered || ptrRefreshing ? '#fff' : '#8B0000'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ transition: 'stroke 0.2s' }} />
                </svg>
              </div>
            </div>
          );
        })()}
        {!loading && chartData && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: t('totalExams'), value: chartData.stats.totalExams, icon: <FileText size={22} color="#007AFF" />, color: '#007AFF', sub: null },
              { label: t('averageScore'), value: chartData.stats.avgScore + '%', icon: <BarChart2 size={22} color="#34C759" />, color: '#34C759', sub: null },
              { label: t('bestScore'), value: chartData.stats.bestScore + '%', icon: <Trophy size={22} color="#FF9500" />, color: '#FF9500', sub: null },
              chartData.stats.recentTrend !== null
                ? {
                    label: 'Improvement',
                    value: (chartData.stats.recentTrend > 0 ? '+' : '') + chartData.stats.recentTrend + '%',
                    icon: chartData.stats.recentTrend > 0 ? <TrendingUp size={22} color="#34C759" /> : chartData.stats.recentTrend < 0 ? <TrendingDown size={22} color="#FF3B30" /> : <Minus size={22} color="#8e8e93" />,
                    color: chartData.stats.recentTrend > 0 ? '#34C759' : chartData.stats.recentTrend < 0 ? '#FF3B30' : '#8e8e93',
                    sub: chartData.stats.recentTrendLabel,
                  }
                : {
                    label: t('latestScore'),
                    value: chartData.stats.latestScore + '%',
                    icon: <Target size={22} color="#8B0000" />,
                    color: '#8B0000',
                    sub: null,
                  },
            ].map((stat, i) => (
              <div key={i} style={{
                background: 'var(--bg-card, #fff)', borderRadius: 14, padding: '16px 14px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center'
              }}>
                <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center' }}>{stat.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary, #8e8e93)', marginTop: 4, fontWeight: 500 }}>{stat.label}</div>
                {stat.sub && <div style={{ fontSize: 10, color: 'var(--text-tertiary, #c7c7cc)', marginTop: 2 }}>{stat.sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ── Smart insight banner ── */}
        {!loading && chartData && chartData.stats.totalExams >= 2 && (() => {
          const { streak, consistency, recentTrend, avgScore, totalExams } = chartData.stats;
          let icon, color, bg, message;

          if (streak >= 3) {
            icon = <Flame size={20} color="#e65100" />; bg = '#fff8e1'; color = '#e65100';
            message = `On a ${streak}-exam winning streak! Keep it up.`;
          } else if (recentTrend !== null && recentTrend >= 5) {
            icon = <Rocket size={20} color="#2e7d32" />; bg = '#e8f5e9'; color = '#2e7d32';
            message = `Strong recent momentum — up ${recentTrend}% in the last exams.`;
          } else if (recentTrend !== null && recentTrend <= -5) {
            icon = <AlertTriangle size={20} color="#e65100" />; bg = '#fff3e0'; color = '#e65100';
            message = `Recent dip of ${Math.abs(recentTrend)}%. May need extra review.`;
          } else if (consistency >= 70) {
            icon = <Zap size={20} color="#1565c0" />; bg = '#e3f2fd'; color = '#1565c0';
            message = `Very consistent — ${consistency}% of exams at or above personal average.`;
          } else if (totalExams >= 5 && avgScore >= 80) {
            icon = <Star size={20} color="#6a1b9a" />; bg = '#f3e5f5'; color = '#6a1b9a';
            message = `Excellent average of ${avgScore}% across ${totalExams} exams.`;
          } else {
            icon = <MapPin size={20} color="#8e8e93" />; bg = '#f2f2f7'; color = '#8e8e93';
            message = `Consistency rate: ${consistency}% of exams at or above personal average.`;
          }

          return (
            <div style={{
              background: bg, borderRadius: 12, padding: '12px 14px',
              marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 10
            }}>
              <span style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start' }}>{icon}</span>
              <p style={{ margin: 0, fontSize: 13, color, fontWeight: 500, lineHeight: 1.4 }}>{message}</p>
            </div>
          );
        })()}

        <div style={{
          background: 'var(--bg-card, #fff)', borderRadius: 12, padding: 12, marginBottom: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #3a3a3c)', display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={13} /> Time Range</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { id: 'all', label: 'All Time' },
              { id: '3months', label: '3 Months' },
              { id: '1month', label: '1 Month' }
            ].map(opt => (
              <button key={opt.id} onClick={() => setTimeRange(opt.id)} style={{
                flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none',
                fontSize: 13, fontWeight: timeRange === opt.id ? 700 : 500,
                background: timeRange === opt.id ? '#8B0000' : 'var(--bg-card2, #f2f2f7)',
                color: timeRange === opt.id ? '#fff' : 'var(--text-primary, #3a3a3c)',
                cursor: 'pointer', transition: 'all 0.2s'
              }}>{opt.label}</button>
            ))}
          </div>
        </div>

        {!loading && chartData && chartData.categories.length > 0 && (
          <div style={{
            background: 'var(--bg-card, #fff)', borderRadius: 12, padding: 12, marginBottom: 16,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
          }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #3a3a3c)', display: 'flex', alignItems: 'center', gap: 6 }}><Folder size={13} /> Categories</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {chartData.categories.map(cat => {
                const colors = {
                  'Kanji': '#FF6B6B', 'Grammar': '#4ECDC4', 'Vocabulary': '#45B7D1',
                  'Reading': '#96CEB4', 'Listening': '#FFEAA7', 'Speaking': '#DDA0DD'
                };
                const color = colors[cat] || '#8B0000';
                const isSelected = selectedCategories.includes(cat);
                return (
                  <button key={cat} onClick={() => toggleCategory(cat)} style={{
                    padding: '6px 14px', borderRadius: 20, border: 'none',
                    fontSize: 12, fontWeight: isSelected ? 700 : 500,
                    background: isSelected ? color : '#f2f2f7',
                    color: isSelected ? '#fff' : '#3a3a3c',
                    cursor: 'pointer', transition: 'all 0.2s'
                  }}>{cat}</button>
                );
              })}
              {selectedCategories.length > 0 && (
                <button onClick={() => setSelectedCategories([])} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1.5px solid #8e8e93',
                  fontSize: 12, fontWeight: 500, background: '#fff',
                  color: '#8e8e93', cursor: 'pointer'
                }}>Clear</button>
              )}
            </div>
          </div>
        )}

        <div style={{
          background: 'var(--bg-card, #fff)', borderRadius: 16, padding: '20px 16px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #1c1c1e)', display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={15} /> Score Trend</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-secondary, #3a3a3c)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 3, background: '#007AFF', borderRadius: 2 }} />
                Actual
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 3, background: '#8B0000', borderRadius: 2, opacity: 0.6 }} />
                Trend
              </span>
            </div>
          </div>
          
          {loading ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 8, height: 8, borderRadius: '50%', background: '#8B0000',
                    animation: `dotPulse 1.1s ease-in-out ${i*0.18}s infinite`
                  }} />
                ))}
              </div>
            </div>
          ) : chartData?.exams.length === 0 ? (
            <div style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary, #8e8e93)' }}>
              <span style={{ marginBottom: 10, color: '#8e8e93', display: 'flex' }}><BarChart2 size={40} /></span>
              <p style={{ margin: 0, fontSize: 14 }}>No exam data available</p>
              <p style={{ margin: '4px 0 0', fontSize: 12 }}>Add exams with dates to see progress</p>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              {renderChart()}
            </div>
          )}
        </div>

        {!loading && chartData && chartData.exams.length > 0 && (
          <div style={{
            background: 'var(--bg-card, #fff)', borderRadius: 16, padding: 16,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #1c1c1e)', display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /> Recent Exams</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chartData.exams.slice(-5).reverse().map((exam, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', background: 'var(--bg-card2, #f9f9f9)', borderRadius: 10
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: exam.percentage >= 60 ? 'var(--green-soft, #e8f5e9)' : 'var(--red-soft, #ffebee)',
                      color: exam.percentage >= 60 ? 'var(--green, #2e7d32)' : 'var(--red, #c62828)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700
                    }}>{exam.percentage}%</span>
                    <div>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #1c1c1e)' }}>{exam.examName}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-tertiary, #8e8e93)' }}>{exam.category} • {exam.dateStr}</p>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: 'var(--text-secondary, #3a3a3c)',
                    background: 'var(--bg-primary, #f2f2f7)', padding: '4px 10px', borderRadius: 8
                  }}>{exam.score}/{exam.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height: 20 }} />
      </div>

      <style>{`@keyframes dotPulse { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1.25)} }`}</style>
    </div>
  );
}

// ── CROP SCREEN COMPONENT ───────────────────────────────────────────────────
function CropScreen({ dataUrl, onConfirm, onRetake }) {
  const imgRef       = useRef(null);
  const containerRef = useRef(null);
  const dragging     = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });

  // crop box as % of the CONTAINER (0–100)
  const [box, setBox] = useState({ left: 8, top: 8, right: 92, bottom: 92 });

  // ── Confirm: convert container-% → image pixels → canvas crop ───
  const confirmCrop = () => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    const { w: iw, h: ih } = imgNatural;
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const drawW = iw * scale, drawH = ih * scale;
    const ox = (cw - drawW) / 2;
    const oy = (ch - drawH) / 2;

    const x1 = Math.max(0,  Math.round(((box.left   / 100) * cw - ox) / scale));
    const y1 = Math.max(0,  Math.round(((box.top    / 100) * ch - oy) / scale));
    const x2 = Math.min(iw, Math.round(((box.right  / 100) * cw - ox) / scale));
    const y2 = Math.min(ih, Math.round(((box.bottom / 100) * ch - oy) / scale));
    const cropW = x2 - x1;
    const cropH = y2 - y1;

    // Guard: if crop is too small just use the full image — never show white
    if (cropW < 20 || cropH < 20) {
      onConfirm(dataUrl);
      return;
    }

    const dst = document.createElement('canvas');
    dst.width  = cropW;
    dst.height = cropH;
    dst.getContext('2d').drawImage(img, x1, y1, cropW, cropH, 0, 0, cropW, cropH);
    const result = dst.toDataURL('image/jpeg', 0.92);
    // Guard: if canvas produced a blank result, fall back to full image
    if (!result || result.length < 1000) {
      onConfirm(dataUrl);
      return;
    }
    onConfirm(result);
  };

  // ── Dragging logic ───────────────────────────────────────────────
  const onHandleStart = (e, corner) => {
    e.preventDefault();
    e.stopPropagation();
    const src = e.touches ? e.touches[0] : e;
    dragging.current = {
      corner,
      startX:   src.clientX,
      startY:   src.clientY,
      startBox: { ...box },
    };
  };

  const onMove = (e) => {
    const d = dragging.current;
    if (!d) return;
    const src = e.touches ? e.touches[0] : e;
    const container = containerRef.current;
    if (!container) return;
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;
    const dx = ((src.clientX - d.startX) / cw) * 100;
    const dy = ((src.clientY - d.startY) / ch) * 100;
    const sb = d.startBox;
    const MIN = 10;

    // Read corner OUTSIDE setBox to avoid stale closure
    const corner = d.corner;
    let { left, top, right, bottom } = sb;
    switch (corner) {
      case 'tl':
        left   = Math.max(0,   Math.min(sb.left   + dx, sb.right  - MIN));
        top    = Math.max(0,   Math.min(sb.top    + dy, sb.bottom - MIN));
        break;
      case 'tr':
        right  = Math.min(100, Math.max(sb.right  + dx, sb.left   + MIN));
        top    = Math.max(0,   Math.min(sb.top    + dy, sb.bottom - MIN));
        break;
      case 'br':
        right  = Math.min(100, Math.max(sb.right  + dx, sb.left   + MIN));
        bottom = Math.min(100, Math.max(sb.bottom + dy, sb.top    + MIN));
        break;
      case 'bl':
        left   = Math.max(0,   Math.min(sb.left   + dx, sb.right  - MIN));
        bottom = Math.min(100, Math.max(sb.bottom + dy, sb.top    + MIN));
        break;
      default: break;
    }
    setBox({ left, top, right, bottom });
  };

  const onEnd = () => { dragging.current = null; };

  // ── Handle style helper ──────────────────────────────────────────
  const handle = (corner, posStyle, label) => (
    <div
      key={corner}
      style={{
        position: 'absolute',
        width: 40, height: 40,
        borderRadius: '50%',
        background: '#00FF88',
        border: '3px solid #fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, fontWeight: 700, color: '#000',
        cursor: 'grab', zIndex: 10,
        touchAction: 'none',
        boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
        transform: 'translate(-50%,-50%)',
        ...posStyle,
      }}
      onMouseDown={e => onHandleStart(e, corner)}
      onTouchStart={e => onHandleStart(e, corner)}
    >{label}</div>
  );

  return (
    <div
      style={{ position:'fixed', inset:0, background:'#000', zIndex:9999, display:'flex', flexDirection:'column' }}
      onMouseMove={onMove} onMouseUp={onEnd}
      onTouchMove={onMove} onTouchEnd={onEnd}
    >
      {/* Top bar */}
      <div style={{ background:'#000', padding:'12px 20px', paddingTop:'env(safe-area-inset-top,12px)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <button onClick={onRetake} style={{ background:'rgba(255,255,255,0.1)', border:'none', color:'#fff', fontSize:15, cursor:'pointer', padding:'10px 16px', borderRadius:8, display:'flex', alignItems:'center', gap:6 }}>
          <ArrowLeft size={15}/> Retake
        </button>
        <span style={{ color:'#fff', fontSize:15, fontWeight:600 }}>Adjust Crop</span>
        <button onClick={confirmCrop} style={{ background:'#007AFF', color:'#fff', border:'none', borderRadius:8, padding:'10px 20px', fontSize:15, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
          Use <Check size={15}/>
        </button>
      </div>
      <div style={{ color:'rgba(255,255,255,0.5)', fontSize:12, textAlign:'center', padding:'4px 0', flexShrink:0 }}>
        Drag each green corner individually
      </div>

      {/* Image + crop overlay */}
      <div
        ref={containerRef}
        style={{ flex:1, position:'relative', overflow:'hidden', background:'#000', display:'flex', alignItems:'center', justifyContent:'center' }}
      >
        {!imgLoaded && (
          <Loader size={32} color="#fff" style={{ animation:'spin 1s linear infinite' }} />
        )}
        <img
          ref={imgRef}
          src={dataUrl}
          onLoad={(e) => {
            setImgNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight });
            setImgLoaded(true);
          }}
          alt="Captured"
          draggable={false}
          style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', display: imgLoaded ? 'block' : 'none', userSelect:'none', pointerEvents:'none' }}
        />

        {imgLoaded && (() => {
          const L  = `${box.left}%`;
          const T  = `${box.top}%`;
          const R  = `${100 - box.right}%`;
          const B  = `${100 - box.bottom}%`;
          return (
            <>
              {/* Dark mask — 4 sides */}
              <div style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
                <div style={{ position:'absolute', top:0,    left:0, right:0,  height:T,              background:'rgba(0,0,0,0.6)' }}/>
                <div style={{ position:'absolute', bottom:0, left:0, right:0,  height:B,              background:'rgba(0,0,0,0.6)' }}/>
                <div style={{ position:'absolute', top:T,    left:0, width:L,  bottom:B,              background:'rgba(0,0,0,0.6)' }}/>
                <div style={{ position:'absolute', top:T,    right:0, width:R, bottom:B,              background:'rgba(0,0,0,0.6)' }}/>
                <div style={{ position:'absolute', top:T, left:L, right:R, bottom:B, border:'2.5px solid #00FF88' }}/>
              </div>
              {/* Individual corner handles — each pinned to its own coordinate */}
              {handle('tl', { top: T,              left: L              }, '↖')}
              {handle('tr', { top: T,              left: `${box.right}%`}, '↗')}
              {handle('br', { top: `${box.bottom}%`, left: `${box.right}%`}, '↘')}
              {handle('bl', { top: `${box.bottom}%`, left: L              }, '↙')}
            </>
          );
        })()}
      </div>

      {/* Bottom bar */}
      <div style={{ flexShrink:0, background:'#000', padding:'14px 24px', paddingBottom:'env(safe-area-inset-bottom,14px)', display:'flex', gap:12 }}>
        <button onClick={onRetake} style={{ flex:1, background:'rgba(255,255,255,0.1)', border:'none', color:'#fff', fontSize:15, fontWeight:600, padding:'14px', borderRadius:12, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          <ArrowLeft size={15}/> Retake
        </button>
        <button onClick={confirmCrop} style={{ flex:2, background:'#007AFF', color:'#fff', border:'none', borderRadius:12, padding:'14px', fontSize:16, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          <Check size={16}/> Use This Page
        </button>
      </div>
    </div>
  );
}

// ── QR SCANNER COMPONENT ─────────────────────────────────────────────────────
// Loads jsQR from CDN for reliable cross-device QR detection
function QRScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState('Loading scanner...');

  useEffect(() => {
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        streamRef.current = stream;
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('Point camera at QR code');

        const scan = () => {
          if (doneRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2) {
            animRef.current = requestAnimationFrame(scan); return;
          }
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (code && code.data) {
            doneRef.current = true;
            onResult(code.data);
            return;
          }
          animRef.current = requestAnimationFrame(scan);
        };

        animRef.current = requestAnimationFrame(scan);
      } catch (err) {
        setStatus('Camera access denied. Please allow camera permission.');
      }
    };

    start();
    return () => {
      doneRef.current = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', zIndex: 9999,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', background: 'rgba(0,0,0,0.7)', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1,
        }}><X size={14} /></button>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Scan QR Code</span>
        <div style={{ width: 32 }} />
      </div>

      {/* Camera */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Viewfinder overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ position: 'relative', width: 240, height: 240 }}>
            {/* Dimmed corners */}
            {[
              { top: 0, left: 0, borderTop: '3px solid #fff', borderLeft: '3px solid #fff', borderRadius: '12px 0 0 0' },
              { top: 0, right: 0, borderTop: '3px solid #fff', borderRight: '3px solid #fff', borderRadius: '0 12px 0 0' },
              { bottom: 0, left: 0, borderBottom: '3px solid #fff', borderLeft: '3px solid #fff', borderRadius: '0 0 0 12px' },
              { bottom: 0, right: 0, borderBottom: '3px solid #fff', borderRight: '3px solid #fff', borderRadius: '0 0 12px 0' },
            ].map((style, i) => (
              <div key={i} style={{ position: 'absolute', width: 36, height: 36, ...style }} />
            ))}
            {/* Scan line animation */}
            <div style={{
              position: 'absolute', left: 8, right: 8, height: 2,
              background: 'linear-gradient(90deg, transparent, #8B0000, transparent)',
              animation: 'qr-scan-line 1.8s ease-in-out infinite',
            }} />
          </div>
        </div>

        {/* Status */}
        <div style={{
          position: 'absolute', bottom: 40, left: 0, right: 0,
          textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600,
          textShadow: '0 1px 4px rgba(0,0,0,0.7)',
        }}>{status}</div>
      </div>

      <style>{`
        @keyframes qr-scan-line {
          0%   { top: 8px; opacity: 1; }
          50%  { top: calc(100% - 8px); opacity: 1; }
          100% { top: 8px; opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── INLINE BARCODE SCANNER ───────────────────────────────────────────────────
// Uses @zxing/browser (npm) — supports Code128, QR, EAN, and more.
function InlineQRScanner({ onResult, onCancel }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animRef   = useRef(null);
  const readerRef = useRef(null);
  const doneRef   = useRef(false);
  const [status, setStatus] = useState('カメラ起動中...');

  useEffect(() => {
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus('QRコードをスキャン');

        // Exact same loop as QRScanner — using jsQR
        const scan = () => {
          if (doneRef.current) return;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2) {
            animRef.current = requestAnimationFrame(scan); return;
          }
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (code && code.data && !code.data.startsWith('http')) {
            doneRef.current = true;
            stream.getTracks().forEach(t => t.stop());
            onResult(code.data);
            return;
          }
          animRef.current = requestAnimationFrame(scan);
        };

        animRef.current = requestAnimationFrame(scan);
      } catch (e) {
        setStatus('カメラエラー: ' + e.message);
      }
    };

    start();
    return () => {
      doneRef.current = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    };
  }, []); // eslint-disable-line

  return (
    <div style={{ position: 'relative', width: '100%', height: 220, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
      <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} playsInline muted />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ width: 160, height: 160, border: '2.5px solid #00FF88', borderRadius: 12, position: 'relative', boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}>
          {/* Corner accents */}
          {[{top:0,left:0},{top:0,right:0},{bottom:0,left:0},{bottom:0,right:0}].map((pos,i) => (
            <div key={i} style={{ position:'absolute', width:18, height:18,
              borderTop: (pos.top===0) ? '3px solid #00FF88' : 'none',
              borderBottom: (pos.bottom===0 && pos.bottom!==undefined) ? '3px solid #00FF88' : 'none',
              borderLeft: (pos.left===0) ? '3px solid #00FF88' : 'none',
              borderRight: (pos.right===0 && pos.right!==undefined) ? '3px solid #00FF88' : 'none',
              ...pos }} />
          ))}
          <div style={{ position: 'absolute', left: 4, right: 4, top: '50%', height: 2, background: 'linear-gradient(90deg,transparent,#00FF88,transparent)', animation: 'qr-scan-line 1.2s ease-in-out infinite' }} />
        </div>
        <div style={{ color: '#fff', fontSize: 12, marginTop: 8, fontWeight: 600, background: 'rgba(0,0,0,0.5)', padding: '3px 10px', borderRadius: 20 }}>{status}</div>
      </div>
      <button onClick={onCancel}
        style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X size={14} />
      </button>
    </div>
  );
}

// ── QUICK ADD EXAM MODAL ─────────────────────────────────────────────────────
function QuickAddExamModal({ student, categories, onSave, onClose }) {
  // categories passed as live prop from App state — always fresh

  const [categoryId,  setCategoryId]  = useState(categories.length === 1 ? categories[0]._id : '');
  const [examNameEn,  setExamNameEn]  = useState('');
  const [examNameJa,  setExamNameJa]  = useState('');
  const [score,       setScore]       = useState('');
  const [totalScore,  setTotalScore]  = useState('');
  const [examDate,    setExamDate]    = useState(new Date().toISOString().split('T')[0]);
  const [showScanner, setShowScanner] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [scanFlash,   setScanFlash]   = useState(false);

  const handleBarcodeResult = (text) => {
    setShowScanner(false);
    setScanFlash(true);
    setTimeout(() => setScanFlash(false), 2000);
    if (text.includes('|')) {
      // Format: nameEn|nameJa|category|totalScore
      const parts = text.split('|');
      const en    = (parts[0] || '').trim();
      const ja    = (parts[1] || '').trim();
      const cat   = (parts[2] || '').trim();
      const total = (parts[3] || '').trim();
      setExamNameEn(en);
      setExamNameJa(ja);
      // Auto-select category if it matches one of the student's categories
      if (cat) {
        const matched = categories.find(c => c.name.toLowerCase() === cat.toLowerCase());
        if (matched) setCategoryId(matched._id);
      }
      // Auto-fill total score
      if (total && !isNaN(parseInt(total))) setTotalScore(total);
    } else {
      setExamNameEn(text.trim());
    }
  };

  const canSave = categoryId && examNameEn && score && totalScore;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const cat = categories.find(c => c._id === categoryId);
    await onSave({ category: cat, examNameEn, examNameJa, score: parseInt(score), totalScore: parseInt(totalScore), date: examDate });
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <h2 className="modal-title">Quick Add Exam</h2>

        {/* Category */}
        <div className="form-group">
          <label>Category</label>
          <select
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            style={{ display:'block', width:'100%', padding:'13px 15px', fontSize:15, borderRadius:'var(--radius-md)', border:'1.5px solid var(--border-med)', background:'var(--surface2)', color:'var(--text-primary)', outline:'none' }}
          >
            <option value="">Select category…</option>
            {categories.map(cat => (
              <option key={cat._id} value={cat._id}>{cat.name}</option>
            ))}
          </select>
          {categories.length === 0 && (
            <p style={{ fontSize:12, color:'var(--red)', marginTop:6 }}>No categories yet — add one first from the profile.</p>
          )}
        </div>

        {/* Barcode Scanner */}
        <div className="form-group">
          <label>Scan QR Code <span style={{ fontWeight:400, color:'var(--text-tertiary)', fontSize:12 }}>— auto-fills exam names</span></label>
          <button
            onClick={() => setShowScanner(v => !v)}
            className={showScanner ? 'btn-secondary' : 'btn-secondary'}
            style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, borderColor: showScanner ? 'var(--red)' : 'var(--border-med)', color: showScanner ? 'var(--red)' : 'var(--text-secondary)' }}
          >
            {showScanner ? <><X size={14}/> Close</> : <><Camera size={14}/> Scan QR</>}
          </button>
          {showScanner && (
            <div style={{ marginTop:10 }}>
              <InlineQRScanner onResult={handleBarcodeResult} onCancel={() => setShowScanner(false)} />
            </div>
          )}
          {scanFlash && (
            <div style={{ marginTop:8, padding:'8px 12px', background:'var(--green-soft)', borderRadius:'var(--radius-sm)', color:'var(--green)', fontWeight:600, fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
              <CheckCircle size={14}/> Barcode scanned successfully!
            </div>
          )}
        </div>

        {/* Exam Name EN */}
        <div className="form-group">
          <label>Exam Name (English)</label>
          <input
            type="text"
            value={examNameEn}
            onChange={e => setExamNameEn(e.target.value)}
            placeholder="e.g. Chapter 3 Quiz"
          />
        </div>

        {/* Exam Name JP */}
        <div className="form-group">
          <label><Flag size={11} style={{ marginRight:4, verticalAlign:'middle' }}/>試験名（日本語）</label>
          <input
            type="text"
            value={examNameJa}
            onChange={e => setExamNameJa(e.target.value)}
            placeholder="例：第3章テスト"
          />
        </div>

        {/* Score / Total */}
        <div style={{ display:'flex', gap:12 }}>
          <div className="form-group" style={{ flex:1 }}>
            <label>Score</label>
            <input type="number" min="0" value={score} onChange={e => setScore(e.target.value)} placeholder="85" />
          </div>
          <div className="form-group" style={{ flex:1 }}>
            <label>Total</label>
            <input type="number" min="1" value={totalScore} onChange={e => setTotalScore(e.target.value)} placeholder="100" />
          </div>
        </div>

        {/* Date */}
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} />
        </div>

        {/* Save */}
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={!canSave || saving}
          style={{ opacity: canSave ? 1 : 0.45, cursor: canSave ? 'pointer' : 'default' }}
        >
          {saving ? 'Saving…' : '+ Add Exam'}
        </button>

        <button className="btn-secondary" onClick={onClose} style={{ marginTop:10 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}


// ── DOCUMENT SCANNER COMPONENT (CamScanner-style) ──────────────────────────
function DocumentScanner({ onCapture, onClose, bulkMode = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const capturingRef = useRef(false);

  // phase: 'camera' | 'crop' | 'review'
  const [phase, setPhase] = useState('camera');
  const [capturedDataUrl, setCapturedDataUrl] = useState(null);
  const [capturedW, setCapturedW] = useState(1);
  const [capturedH, setCapturedH] = useState(1);
  const [status, setStatus] = useState('Initializing camera...');
  const [scannedPages, setScannedPages] = useState([]);
  const [bulkUploading, setBulkUploading] = useState(false);

  // ── START CAMERA ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'camera') return;
    capturingRef.current = false;
    let active = true;
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.onloadedmetadata = async () => {
          try { await video.play(); } catch {}
          setStatus('Point camera at document — tap shutter');
          animFrameRef.current = requestAnimationFrame(overlayLoop);
        };
      } catch { setStatus('Camera access denied.'); }
    };
    startCamera();
    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    };
  }, [phase]); // eslint-disable-line

  // ── OVERLAY GUIDE RECT ───────────────────────────────────────────
  const overlayLoop = () => {
    const overlay = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!overlay || !video || video.readyState < 2) { animFrameRef.current = requestAnimationFrame(overlayLoop); return; }
    overlay.width = overlay.offsetWidth;
    overlay.height = overlay.offsetHeight;
    if (!overlay.width || !overlay.height) { animFrameRef.current = requestAnimationFrame(overlayLoop); return; }
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const px = overlay.width * 0.075, py = overlay.height * 0.1;
    const rw = overlay.width - px * 2, rh = overlay.height - py * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    ctx.clearRect(px, py, rw, rh);
    ctx.strokeStyle = '#00FF88'; ctx.lineWidth = 3; ctx.setLineDash([12,6]);
    ctx.strokeRect(px, py, rw, rh); ctx.setLineDash([]);
    [[px,py],[px+rw,py],[px+rw,py+rh],[px,py+rh]].forEach(([x,y]) => {
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fillStyle='#00FF88'; ctx.fill();
    });
    animFrameRef.current = requestAnimationFrame(overlayLoop);
  };

  // ── TAKE PHOTO → crop phase ──────────────────────────────────────
  const takePhoto = () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) { capturingRef.current = false; return; }
    const capture = () => {
      const W = video.videoWidth, H = video.videoHeight;
      if (!W || !H || video.readyState < 2) { requestAnimationFrame(capture); return; }
      canvas.width = W; canvas.height = H;
      canvas.getContext('2d').drawImage(video, 0, 0, W, H);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      setCapturedDataUrl(dataUrl);
      setCapturedW(W); setCapturedH(H);
      setPhase('crop');
    };
    capture();
  };

  // ── CROP CONFIRMED ───────────────────────────────────────────────
  const handleCropDone = (croppedDataUrl) => {
    if (bulkMode) {
      setScannedPages(prev => [...prev, croppedDataUrl]);
      setCapturedDataUrl(null);
      setPhase('review');
    } else {
      onCapture(croppedDataUrl);
    }
  };

  const retake = () => { setCapturedDataUrl(null); setPhase('camera'); };
  const scanNextPage = () => { setCapturedDataUrl(null); setPhase('camera'); };
  const finishBulkScan = async () => {
    if (!scannedPages.length) return;
    setBulkUploading(true);
    await onCapture(scannedPages);
    setBulkUploading(false);
  };
  const removeBulkPage = (idx) => setScannedPages(prev => prev.filter((_, i) => i !== idx));

  // ── CROP PHASE ────────────────────────────────────────────────────
  if (phase === 'crop' && capturedDataUrl) {
    return (
      <CropScreen
        dataUrl={capturedDataUrl}
        onConfirm={handleCropDone}
        onRetake={retake}
      />
    );
  }

  // ── BULK REVIEW PHASE ─────────────────────────────────────────────
  if (bulkMode && phase === 'review') {
    return (
      <div style={{ position:'fixed', inset:0, background:'#111', zIndex:9999, display:'flex', flexDirection:'column' }}>
        <div style={{ background:'#000', padding:'12px 20px', paddingTop:'env(safe-area-inset-top,12px)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.1)', border:'none', color:'#fff', fontSize:15, cursor:'pointer', padding:'10px 16px', borderRadius:8 }}>Cancel</button>
          <span style={{ color:'#fff', fontSize:15, fontWeight:600 }}>{scannedPages.length} Page{scannedPages.length!==1?'s':''} Scanned</span>
          <button onClick={finishBulkScan} disabled={bulkUploading||!scannedPages.length}
            style={{ background:!scannedPages.length?'rgba(0,122,255,0.4)':'#34C759', color:'#fff', border:'none', borderRadius:8, padding:'10px 14px', fontSize:14, fontWeight:700, cursor:!scannedPages.length?'default':'pointer' }}>
            {bulkUploading?<><Loader size={14} style={{animation:'spin 1s linear infinite',marginRight:4,verticalAlign:'middle'}}/>Uploading…</>:<><CheckCircle size={14} style={{marginRight:4,verticalAlign:'middle'}}/>Done ({scannedPages.length})</>}
          </button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:12, display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10, alignContent:'start' }}>
          {scannedPages.map((url,idx) => (
            <div key={idx} style={{ position:'relative', borderRadius:10, overflow:'hidden', background:'#222', aspectRatio:'3/4' }}>
              <img src={url} alt={`Page ${idx+1}`} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
              <div style={{ position:'absolute', top:6, left:6, background:'rgba(0,0,0,0.72)', color:'#fff', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10 }}>Page {idx+1}</div>
              <button onClick={()=>removeBulkPage(idx)} style={{ position:'absolute', top:6, right:6, background:'rgba(255,59,48,0.9)', color:'#fff', border:'none', borderRadius:'50%', width:26, height:26, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><X size={14}/></button>
            </div>
          ))}
        </div>
        <div style={{ flexShrink:0, background:'#000', padding:'14px 24px', paddingBottom:'env(safe-area-inset-bottom,14px)', display:'flex', justifyContent:'center' }}>
          <button onClick={scanNextPage} style={{ background:'#fff', color:'#000', border:'none', borderRadius:14, padding:'14px 48px', fontSize:16, fontWeight:700, cursor:'pointer' }}>
            <Camera size={16} style={{marginRight:8,verticalAlign:'middle'}}/>Scan Next Page
          </button>
        </div>
      </div>
    );
  }

  // ── CAMERA PHASE ─────────────────────────────────────────────────
  return (
    <div style={{ position:'fixed', inset:0, background:'#000', zIndex:9999, display:'flex', flexDirection:'column' }}>
      <div style={{ flexShrink:0, background:'rgba(0,0,0,0.85)', paddingTop:'env(safe-area-inset-top,12px)', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <button onClick={onClose} style={{ background:'rgba(255,255,255,0.15)', color:'#fff', border:'none', borderRadius:10, padding:'8px 18px', fontSize:15, cursor:'pointer' }}>Cancel</button>
        <div style={{ background:'rgba(60,60,60,0.9)', color:'#fff', padding:'6px 16px', borderRadius:20, fontSize:13, fontWeight:600 }}>{status}</div>
        {bulkMode && scannedPages.length > 0
          ? <button onClick={()=>setPhase('review')} style={{ background:'#34C759', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>Review ({scannedPages.length})</button>
          : <div style={{width:80}}/>}
      </div>
      <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
        <video ref={videoRef} style={{ width:'100%', height:'100%', objectFit:'cover' }} playsInline muted />
        <canvas ref={overlayCanvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
        <canvas ref={canvasRef} style={{ display:'none' }} />
      </div>
      <div style={{ flexShrink:0, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 0', paddingBottom:'env(safe-area-inset-bottom,24px)' }}>
        <button onClick={takePhoto} style={{ width:72, height:72, borderRadius:'50%', background:'#fff', border:'4px solid rgba(255,255,255,0.4)', boxShadow:'0 0 0 3px #fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Camera size={28} color="#000"/>
        </button>
      </div>
    </div>
  );
}

// ── SETTINGS PAGE ────────────────────────────────────────────────────────────
// ── QR CODE GENERATOR TAB ────────────────────────────────────────────────────

function QRItem({ entry, onDelete }) {
  const canvasRef = useRef(null);

  // QR value format: nameEn|nameJa|category|totalScore
  // Fields after nameEn are optional; empty string preserved for positional parsing
  const buildQRValue = (e) => {
    const parts = [e.nameEn, e.nameJa || '', e.category || '', e.totalScore ? String(e.totalScore) : ''];
    // Trim trailing empty parts only if ALL optional fields are empty
    if (!e.nameJa && !e.category && !e.totalScore) return e.nameEn;
    return parts.join('|');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const value = buildQRValue(entry);
    QRCode.toCanvas(canvas, value, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(e => console.error('QR error', e));
  }, [entry.nameEn, entry.nameJa, entry.category, entry.totalScore]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${entry.nameEn.replace(/\s+/g, '-')}-qr.png`;
    a.click();
  };

  const handlePrint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const imgData = canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>${entry.nameEn}</title>
      <style>
        body { margin: 24px; font-family: -apple-system, sans-serif; text-align: center; }
        img { display: block; margin: 0 auto; }
        .meta { font-size:12px; color:#888; margin-top:4px; }
        @media print { button { display: none; } }
      </style></head>
      <body>
        <div style="font-size:18px;font-weight:700;margin-bottom:2px;">${entry.nameEn}</div>
        ${entry.nameJa ? `<div style="font-size:14px;color:#555;margin-bottom:4px;">${entry.nameJa}</div>` : ''}
        ${entry.category ? `<div class="meta">📁 ${entry.category}</div>` : ''}
        ${entry.totalScore ? `<div class="meta">Total Score: ${entry.totalScore}</div>` : ''}
        <div style="margin-bottom:12px;"></div>
        <img src="${imgData}" width="200" height="200" />
        <script>window.onload=()=>{ window.print(); }<\/script>
      </body></html>`);
    win.document.close();
  };

  return (
    <div style={{ background:'#fff', borderRadius:16, padding:16, boxShadow:'0 2px 8px rgba(0,0,0,0.06)', marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'#1c1c1e' }}>{entry.nameEn}</div>
          {entry.nameJa && <div style={{ fontSize:13, color:'#8e8e93', marginTop:2 }}>{entry.nameJa}</div>}
          <div style={{ display:'flex', gap:8, marginTop:4, flexWrap:'wrap' }}>
            {entry.category && (
              <span style={{ fontSize:12, color:'#8B0000', background:'rgba(139,0,0,0.08)', borderRadius:6, padding:'2px 8px', fontWeight:600 }}>
                📁 {entry.category}
              </span>
            )}
            {entry.totalScore && (
              <span style={{ fontSize:12, color:'#007AFF', background:'rgba(0,122,255,0.08)', borderRadius:6, padding:'2px 8px', fontWeight:600 }}>
                Total: {entry.totalScore}
              </span>
            )}
          </div>
        </div>
        <button onClick={() => onDelete(entry.id)} style={{ background:'none', border:'none', color:'#ff3b30', cursor:'pointer', padding:4, flexShrink:0 }}>
          <Trash2 size={16}/>
        </button>
      </div>
      <div style={{ display:'flex', justifyContent:'center', background:'#fafafa', borderRadius:10, padding:12, marginBottom:10 }}>
        <canvas ref={canvasRef} />
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={handlePrint}
          style={{ flex:1, background:'#8B0000', color:'#fff', border:'none', borderRadius:10, padding:'10px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
          🖨️ Print
        </button>
        <button onClick={handleDownload}
          style={{ flex:1, background:'#f2f2f7', color:'#3a3a3c', border:'none', borderRadius:10, padding:'10px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
          ⬇️ Save PNG
        </button>
      </div>
    </div>
  );
}

function BarcodeGeneratorTab({ batches = [] }) {
  const [nameEn,      setNameEn]     = useState('');
  const [nameJa,      setNameJa]     = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [category,    setCategory]   = useState('');
  const [totalScore,  setTotalScore] = useState('');
  const [entries,     setEntries]    = useState([]);

  // Categories unique to the selected batch only
  const batchCats = useMemo(() => {
    if (!selectedBatchId) return [];
    const batch = batches.find(b => b._id === selectedBatchId);
    if (!batch) return [];
    // Use normalized key (trimmed + lowercase) to deduplicate, keep first-seen casing
    const seen = new Map();
    (batch.students || []).forEach(s =>
      (s.categories || []).forEach(c => {
        if (!c.name) return;
        const key = c.name.trim().toLowerCase();
        if (!seen.has(key)) seen.set(key, c.name.trim());
      })
    );
    return Array.from(seen.values()).sort();
  }, [batches, selectedBatchId]);

  // Reset category when batch changes
  const handleBatchChange = (batchId) => {
    setSelectedBatchId(batchId);
    setCategory('');
  };

  const addEntry = () => {
    if (!nameEn.trim()) return;
    setEntries(prev => [...prev, {
      id: Date.now(),
      nameEn: nameEn.trim(),
      nameJa: nameJa.trim(),
      category: category,
      totalScore: totalScore ? parseInt(totalScore) : null,
    }]);
    setNameEn('');
    setNameJa('');
    // keep batch, category & totalScore for easy batch-generating same exam type
  };

  const deleteEntry = (id) => setEntries(prev => prev.filter(e => e.id !== id));

  // QR value format: nameEn|nameJa|category|totalScore
  const buildQRValue = (entry) => {
    if (!entry.nameJa && !entry.category && !entry.totalScore) return entry.nameEn;
    return [entry.nameEn, entry.nameJa || '', entry.category || '', entry.totalScore ? String(entry.totalScore) : ''].join('|');
  };

  const printAll = () => {
    const canvases = document.querySelectorAll('.qr-canvas-print');
    let rows = '';
    entries.forEach((entry, i) => {
      const c = canvases[i];
      if (!c) return;
      rows += `
        <div style="page-break-inside:avoid;margin-bottom:24px;border:1px solid #e0e0e0;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:16px;font-weight:700;margin-bottom:2px;">${entry.nameEn}</div>
          ${entry.nameJa ? `<div style="font-size:13px;color:#555;margin-bottom:4px;">${entry.nameJa}</div>` : ''}
          ${entry.category ? `<div style="font-size:12px;color:#8B0000;margin-bottom:2px;">📁 ${entry.category}</div>` : ''}
          ${entry.totalScore ? `<div style="font-size:12px;color:#555;margin-bottom:8px;">Total Score: ${entry.totalScore}</div>` : '<div style="margin-bottom:8px;"></div>'}
          <img src="${c.toDataURL('image/png')}" width="180" />
        </div>`;
    });
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Exam QR Codes</title>
      <style>body{margin:20px;font-family:-apple-system,sans-serif;}@media print{button{display:none;}}</style>
      </head><body>${rows}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
    win.document.close();
  };

  const inputStyle = { display:'block', width:'100%', padding:'12px 14px', fontSize:15, borderRadius:10, border:'1.5px solid #e5e5ea', background:'#f9f9f9', outline:'none', boxSizing:'border-box' };
  const selectStyle = { ...inputStyle, appearance:'auto', color:'#1c1c1e' };
  const labelStyle  = { fontSize:12, fontWeight:600, color:'#8e8e93', display:'block', marginBottom:6 };

  return (
    <div>
      <div style={{ background:'#fff', borderRadius:16, padding:20, boxShadow:'0 2px 8px rgba(0,0,0,0.06)', marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:700, color:'#1c1c1e', marginBottom:4 }}>📱 Exam QR Code Generator</div>
        <div style={{ fontSize:12, color:'#8e8e93', marginBottom:16 }}>Scan with the Add Exam modal to auto-fill exam name, category, and total score</div>

        {/* Step 1 — Select Batch */}
        <div style={{ marginBottom:12 }}>
          <label style={labelStyle}>
            <Layers size={11} style={{ marginRight:4, verticalAlign:'middle' }}/>Batch *
          </label>
          <select
            value={selectedBatchId}
            onChange={e => handleBatchChange(e.target.value)}
            style={{ ...selectStyle, color: selectedBatchId ? '#1c1c1e' : '#8e8e93' }}
          >
            <option value="">Select batch…</option>
            {batches.map(b => (
              <option key={b._id} value={b._id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* Step 2 — Exam Category (updates when batch is selected) */}
        <div style={{ marginBottom:12 }}>
          <label style={labelStyle}>
            <Folder size={11} style={{ marginRight:4, verticalAlign:'middle' }}/>Exam Category — optional
          </label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            disabled={!selectedBatchId}
            style={{ ...selectStyle, color: category ? '#1c1c1e' : '#8e8e93', opacity: selectedBatchId ? 1 : 0.45 }}
          >
            <option value="">{selectedBatchId ? 'Select category…' : 'Select a batch first'}</option>
            {batchCats.length === 0 && selectedBatchId
              ? <option disabled>No categories in this batch</option>
              : batchCats.map(c => <option key={c} value={c}>{c}</option>)
            }
          </select>
          {selectedBatchId && (
            <div style={{ fontSize:11, color:'#8e8e93', marginTop:4 }}>
              Showing categories from selected batch only. When scanned, auto-selects matching category.
            </div>
          )}
        </div>

        {/* Exam Name EN */}
        <div style={{ marginBottom:12 }}>
          <label style={labelStyle}>Exam Name (English) *</label>
          <input type="text" value={nameEn} onChange={e => setNameEn(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEntry()}
            placeholder="e.g. Chapter 3 Quiz"
            style={inputStyle}
          />
        </div>

        {/* Exam Name JA */}
        <div style={{ marginBottom:12 }}>
          <label style={labelStyle}>
            <Flag size={11} style={{ marginRight:4, verticalAlign:'middle' }}/>試験名（日本語）— optional
          </label>
          <input type="text" value={nameJa} onChange={e => setNameJa(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEntry()}
            placeholder="例：第3章テスト"
            style={inputStyle}
          />
        </div>

        {/* Total Score */}
        <div style={{ marginBottom:16 }}>
          <label style={labelStyle}>
            <Target size={11} style={{ marginRight:4, verticalAlign:'middle' }}/>Total Score — optional
          </label>
          <input
            type="number"
            min="1"
            value={totalScore}
            onChange={e => setTotalScore(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEntry()}
            placeholder="e.g. 100"
            style={inputStyle}
          />
          <div style={{ fontSize:11, color:'#8e8e93', marginTop:4 }}>
            Auto-fills the Total field in the modal — you only need to type the score.
          </div>
        </div>

        <button onClick={addEntry} disabled={!nameEn.trim()}
          style={{ width:'100%', background: nameEn.trim() ? '#8B0000' : '#e5e5ea', color: nameEn.trim() ? '#fff' : '#aaa', border:'none', borderRadius:12, padding:'14px', fontSize:16, fontWeight:700, cursor: nameEn.trim() ? 'pointer' : 'default' }}>
          + Generate QR Code
        </button>
      </div>

      {entries.length > 1 && (
        <button onClick={printAll}
          style={{ width:'100%', background:'#1c1c1e', color:'#fff', border:'none', borderRadius:12, padding:'13px', fontSize:15, fontWeight:600, cursor:'pointer', marginBottom:16, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          🖨️ Print All ({entries.length})
        </button>
      )}

      {entries.length === 0 && (
        <div style={{ textAlign:'center', padding:'40px 20px', color:'#8e8e93' }}>
          <div style={{ fontSize:36, marginBottom:8 }}>📱</div>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>No QR codes yet</div>
          <div style={{ fontSize:13 }}>Select a batch and fill in the exam details above</div>
        </div>
      )}

      {entries.map(entry => <QRItem key={entry.id} entry={entry} onDelete={deleteEntry} />)}

      {/* Hidden canvases for Print All */}
      <div style={{ display:'none' }}>
        {entries.map(entry => {
          const value = buildQRValue(entry);
          const ref = (el) => {
            if (!el) return;
            QRCode.toCanvas(el, value, { width: 200, margin: 2 }).catch(() => {});
          };
          return <canvas key={entry.id} className="qr-canvas-print" ref={ref} />;
        })}
      </div>
    </div>
  );
}

function SettingsPage({ batches, onClose, API }) {
  const [storage, setStorage] = useState(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageError, setStorageError] = useState(null);
  const [clearLoading, setClearLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('storage');
  const isAdminUser = (typeof safeLocalGet === 'function' ? safeLocalGet(ROLE_KEY) : null) === 'admin';

  // ── Change Password state ──
  const [pwAccounts, setPwAccounts] = useState([]);
  const [pwTarget, setPwTarget] = useState('');        // target username
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState(null);            // { type:'ok'|'err', text }
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (activeSection !== 'security' || !isAdminUser) return;
    (async () => {
      try {
        const token = safeLocalGet(TOKEN_KEY);
        const res = await fetch(`${API}/auth/accounts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (Array.isArray(data)) setPwAccounts(data);
      } catch {}
    })();
  }, [activeSection, isAdminUser, API]);

  const submitChangePassword = async () => {
    setPwMsg(null);
    if (!pwTarget) { setPwMsg({ type: 'err', text: 'Please choose an account.' }); return; }
    if (pwNew.length < 6) { setPwMsg({ type: 'err', text: 'New password must be at least 6 characters.' }); return; }
    if (pwNew !== pwConfirm) { setPwMsg({ type: 'err', text: 'New password and confirmation do not match.' }); return; }
    setPwBusy(true);
    try {
      const token = safeLocalGet(TOKEN_KEY);
      const res = await fetch(`${API}/auth/change-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, targetUsername: pwTarget, currentPassword: pwCurrent, newPassword: pwNew }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setPwMsg({ type: 'err', text: data.error || 'Could not change password.' }); return; }
      // If the admin changed their OWN password, the server returns a fresh token — keep this session alive
      if (data.token) safeLocalSet(TOKEN_KEY, data.token);
      setPwMsg({ type: 'ok', text: `Password updated for "${data.rotated}". Anyone currently logged into that account will be signed out.` });
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
    } catch (e) {
      setPwMsg({ type: 'err', text: 'Cannot reach the server. Please try again.' });
    } finally {
      setPwBusy(false);
    }
  };

  // Compute app stats from batches
  const totalStudents = batches.reduce((s, b) => s + b.students.length, 0);
  const totalExams = batches.reduce((s, b) =>
    s + b.students.reduce((ss, st) =>
      ss + (st.categories || []).reduce((sss, c) => sss + (c.items || []).length, 0), 0), 0);
  const totalImages = batches.reduce((s, b) =>
    s + b.students.reduce((ss, st) =>
      ss + (st.categories || []).reduce((sss, c) =>
        sss + (c.items || []).reduce((si, i) => si + (i.images || []).length, 0), 0), 0), 0);
  const totalBatches = batches.length;
  const APP_VERSION = '2.4.0';

  useEffect(() => {
    const fetchStorage = async () => {
      setStorageLoading(true);
      try {
        const res = await fetch(`${API}/admin/storage-usage`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setStorage(data);
      } catch (e) {
        setStorageError(e.message);
      } finally {
        setStorageLoading(false);
      }
    };
    fetchStorage();
  }, [API]);
  const [serverStats, setServerStats] = useState(null);
const [serverLoading, setServerLoading] = useState(false);
const [serverError, setServerError] = useState(null);

const fetchServerStats = async () => {
  setServerLoading(true);
  setServerError(null);
  try {
    const res = await fetch(`${API}/admin/server-stats`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setServerStats(data);
  } catch (e) {
    setServerError(e.message);
  } finally {
    setServerLoading(false);
  }
};

useEffect(() => {
  if (activeSection === 'server') fetchServerStats();
}, [activeSection]);

  const formatBytes = (bytes) => {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const usedBytes = storage?.used_bytes ?? 0;
  const limitBytes = storage?.limit_bytes ?? (25 * 1024 * 1024 * 1024); // 25GB Cloudinary free
  const usedPct = Math.min((usedBytes / limitBytes) * 100, 100);
  const barColor = usedPct > 85 ? '#ff3b30' : usedPct > 65 ? '#ff9500' : '#34C759';

  const navItems = [
    { id: 'storage', label: t('storageTab') },
    { id: 'stats', label: t('appInfoTab') },
    { id: 'server', label: t('serverTab') },
    { id: 'manage', label: t('manageTab') },
    { id: 'barcodes', label: 'QR Codes' },
    ...(isAdminUser ? [{ id: 'security', label: 'Security' }] : []),
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: '#f2f2f7', display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #8B0000, #c0392b)',
        padding: '16px 20px',
        paddingTop: 'env(safe-area-inset-top, 16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
        boxShadow: '0 2px 12px rgba(139,0,0,0.3)',
      }}>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
          borderRadius: 10, padding: '8px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer'
        }}>{t('back')}</button>
        <span style={{ color: '#fff', fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>{t('settings')}</span>
        <div style={{ width: 72 }} />
      </div>

      {/* Tab Nav */}
      <div style={{
        display: 'flex', background: '#fff',
        borderBottom: '1px solid #e5e5ea', flexShrink: 0,
      }}>
        {navItems.map(n => (
          <button key={n.id} onClick={() => setActiveSection(n.id)} style={{
            flex: 1, padding: '12px 4px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: activeSection === n.id ? 700 : 500,
            color: activeSection === n.id ? '#8B0000' : '#8e8e93',
            borderBottom: activeSection === n.id ? '2.5px solid #8B0000' : '2.5px solid transparent',
            transition: 'all 0.18s',
          }}>{n.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', paddingBottom: 32 }}>

        {/* ── STORAGE TAB ── */}
        {activeSection === 'storage' && (
          <div>
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', display: 'flex', alignItems: 'center', gap: 6 }}><Layers size={15} /> Cloudinary Storage</span>
                {storageLoading && <span style={{ fontSize: 12, color: '#8e8e93' }}>Loading…</span>}
                {storageError && <span style={{ fontSize: 12, color: '#ff3b30', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12} /> Error</span>}
              </div>

              {storageLoading ? (
                <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#8B0000', animation: `dotPulse 1.1s ease-in-out ${i*0.18}s infinite` }} />
                    ))}
                  </div>
                </div>
              ) : storageError ? (
                <div style={{ textAlign: 'center', padding: '16px 0', color: '#ff3b30', fontSize: 13 }}>
                  {storageError}<br />
                  <span style={{ color: '#8e8e93', fontSize: 12 }}>Check CLOUDINARY_API_KEY & CLOUDINARY_API_SECRET in server env.</span>
                </div>
              ) : (
                <>
                  {/* Big usage numbers */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#1c1c1e', lineHeight: 1 }}>{formatBytes(usedBytes)}</div>
                      <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 2 }}>used of {formatBytes(limitBytes)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: barColor, lineHeight: 1 }}>{usedPct.toFixed(1)}%</div>
                      <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 2 }}>{formatBytes(limitBytes - usedBytes)} free</div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ background: '#f2f2f7', borderRadius: 99, height: 12, overflow: 'hidden', marginBottom: 16 }}>
                    <div style={{
                      height: '100%', width: `${usedPct}%`,
                      background: usedPct > 85
                        ? 'linear-gradient(90deg, #ff9500, #ff3b30)'
                        : usedPct > 65
                        ? 'linear-gradient(90deg, #34C759, #ff9500)'
                        : 'linear-gradient(90deg, #34C759, #30d158)',
                      borderRadius: 99,
                      transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
                    }} />
                  </div>

                  {/* Resource breakdown */}
                  {storage?.resources && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {[
                        { label: <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Image size={13} /> Images</span>, count: storage.resources.image_count, size: storage.resources.image_size },
                        { label: <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><File size={13} /> Raw files</span>, count: storage.resources.raw_count, size: storage.resources.raw_size },
                      ].map((r, i) => (
                        <div key={i} style={{ background: '#f9f9f9', borderRadius: 12, padding: '12px 14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1c1e', marginBottom: 2 }}>{r.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: '#3a3a3c' }}>{(r.count || 0).toLocaleString()}</div>
                          <div style={{ fontSize: 11, color: '#8e8e93' }}>{formatBytes(r.size)}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {usedPct > 80 && (
                    <div style={{ marginTop: 14, background: '#fff3cd', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#856404', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertTriangle size={14} color="#856404" /> Storage is getting full. Consider archiving old images.
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 13, color: '#8e8e93', lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: '#3a3a3c' }}>Plan: </span>Cloudinary Free Tier — 25 GB storage, 25 GB bandwidth/month.
                Images are stored in the <code style={{ background: '#f2f2f7', padding: '1px 5px', borderRadius: 4 }}>sage-bulacan</code> folder.
              </div>
            </div>
          </div>
        )}

        {/* ── APP INFO TAB ── */}
        {activeSection === 'stats' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'linear-gradient(135deg, #8B0000, #c0392b)', borderRadius: 16, padding: 20, color: '#fff' }}>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>App Version</div>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1 }}>v{APP_VERSION}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Sage Asian Japanese Tracker</div>
            </div>

            {[
              { icon: <Layers size={26} color="#8B0000" />, label: t('totalBatches'), value: totalBatches },
              { icon: <Users size={26} color="#8B0000" />, label: t('totalStudents'), value: totalStudents.toLocaleString() },
              { icon: <FileText size={26} color="#8B0000" />, label: t('totalExams'), value: totalExams.toLocaleString() },
              { icon: <Image size={26} color="#8B0000" />, label: t('totalImages'), value: totalImages.toLocaleString() },
            ].map((stat, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 14, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: 'rgba(139,0,0,0.08)', flexShrink: 0 }}>{stat.icon}</span>
                <div>
                  <div style={{ fontSize: 13, color: '#8e8e93' }}>{stat.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#1c1c1e', lineHeight: 1.2 }}>{stat.value}</div>
                </div>
              </div>
            ))}

            <div style={{ background: '#fff', borderRadius: 14, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 13, color: '#8e8e93', marginBottom: 6 }}>Backend</div>
              <div style={{ fontSize: 13, color: '#3a3a3c', fontWeight: 500 }}>Railway · MongoDB Atlas · Cloudinary CDN</div>
            </div>
          </div>
        )}

        {/* ── MANAGE TAB ── */}
        {activeSection === 'manage' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}><Image size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />Image Storage</div>
              <p style={{ fontSize: 13, color: '#6e6e73', margin: '0 0 16px 0', lineHeight: 1.5 }}>
                To free up Cloudinary storage, use the <strong>📦 Archive</strong> feature per student to move old exam images to the archive folder. Archived images are still accessible but won't count against your active quota in most plans.
              </p>
              <div style={{ background: '#f2f2f7', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: '#3a3a3c' }}>
                <strong>How to archive:</strong><br />
                Student → Categories screen → tap <strong>📦 Archive</strong>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>🗑️ Permanent Delete</div>
              <p style={{ fontSize: 13, color: '#6e6e73', margin: '0 0 16px 0', lineHeight: 1.5 }}>
                To permanently delete a student and all their images from Cloudinary and the database, use the <strong>Delete</strong> button on the student's Categories screen. This <strong>cannot be undone</strong>.
              </p>
              <div style={{ background: '#fff3f3', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: '#c0392b', fontWeight: 500 }}>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: '#856404', display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={12} /> Permanent delete removes all data from Cloudinary and MongoDB.</p>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}><BarChart2 size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />Storage by Batch</div>
              <p style={{ fontSize: 13, color: '#6e6e73', margin: '0 0 12px 0' }}>Estimated image count per batch:</p>
              {batches.map(b => {
                const imgCount = b.students.reduce((s, st) =>
                  s + (st.categories || []).reduce((ss, c) =>
                    ss + (c.items || []).reduce((si, i) => si + (i.images || []).length, 0), 0), 0);
                const pct = totalImages > 0 ? (imgCount / totalImages) * 100 : 0;
                return (
                  <div key={b._id} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#3a3a3c' }}><BookOpen size={12} style={{ marginRight: 5, verticalAlign: "middle" }} />{b.name}</span>
                      <span style={{ fontSize: 12, color: '#8e8e93' }}>{imgCount} images</span>
                    </div>
                    <div style={{ background: '#f2f2f7', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #8B0000, #c0392b)', borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}

            </div>
          </div>
        )}

        {/* ── SERVER MONITOR TAB ── */}
        {activeSection === 'server' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={fetchServerStats} disabled={serverLoading} style={{
                background: serverLoading ? '#e5e5ea' : '#8B0000',
                color: serverLoading ? '#8e8e93' : '#fff',
                border: 'none', borderRadius: 10, padding: '8px 18px',
                fontSize: 13, fontWeight: 600, cursor: serverLoading ? 'default' : 'pointer'
              }}>
                {serverLoading ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite', marginRight: 4, verticalAlign: 'middle' }} />{t('loading')}</> : t('refresh')}
              </button>
            </div>

            {serverError && (
              <div style={{ background: '#fff3f3', borderRadius: 14, padding: 16, color: '#c0392b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} /> {serverError}
              </div>
            )}

            {serverStats && (() => {
              const mem = serverStats.memory;
              const memPct = Math.round((mem.used / mem.total) * 100);
              const memColor = memPct > 85 ? '#ff3b30' : memPct > 65 ? '#ff9500' : '#34C759';
              const r = serverStats.render;
              const renderPct = r.percentUsed;
              const renderColor = renderPct > 90 ? '#ff3b30' : renderPct > 70 ? '#ff9500' : '#34C759';
              const fmtBytes = (b) => {
                if (!b) return '0 B';
                if (b < 1024) return b + ' B';
                if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
                if (b < 1024*1024*1024) return (b/(1024*1024)).toFixed(1) + ' MB';
                return (b/(1024*1024*1024)).toFixed(2) + ' GB';
              };
              const bwPct = r.bandwidthLimitBytes ? Math.min((r.bandwidthUsedBytes / r.bandwidthLimitBytes) * 100, 100) : 0;
              const bwColor = bwPct > 85 ? '#ff3b30' : bwPct > 65 ? '#ff9500' : '#34C759';

              return (
                <>
                  {/* API source badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: r.apiAvailable ? '#f0fff4' : '#fffbe6', borderRadius: 10, fontSize: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.apiAvailable ? '#34C759' : '#ff9500' }} />
                    <span style={{ color: r.apiAvailable ? '#1a7f37' : '#856404', fontWeight: 600 }}>
                      {r.apiAvailable ? 'Live data mula sa Render API' : 'Estimated data (walang API key)'}
                    </span>
                  </div>

                  {/* Instance Hours Card */}
                  <div style={{ background: r.willSuspend ? '#fff3f3' : '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={15} /> Instance Hours
                      {r.willSuspend && <span style={{ marginLeft: 8, fontSize: 12, background: '#ff3b30', color: '#fff', borderRadius: 6, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={10} /> Malapit maubos!</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#8e8e93', marginBottom: 12 }}>Monthly Included Usage — resets every 1st of month</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', lineHeight: 1 }}>{r.hoursUsed}h</div>
                        <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 2 }}>nagamit ngayong buwan</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 32, fontWeight: 800, color: renderColor, lineHeight: 1 }}>{r.hoursLeft}h</div>
                        <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 2 }}>natitira sa {r.limitHours}h</div>
                      </div>
                    </div>
                    <div style={{ background: '#f2f2f7', borderRadius: 99, height: 12, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ height: '100%', width: `${renderPct}%`, background: renderPct > 90 ? 'linear-gradient(90deg,#ff9500,#ff3b30)' : renderPct > 70 ? 'linear-gradient(90deg,#34C759,#ff9500)' : 'linear-gradient(90deg,#34C759,#30d158)', borderRadius: 99, transition: 'width 0.8s cubic-bezier(0.34,1.56,0.64,1)' }} />
                    </div>
                    <div style={{ fontSize: 12, color: '#8e8e93' }}>{renderPct}% ng 750h monthly limit</div>
                    {r.willSuspend && (
                      <div style={{ marginTop: 10, background: '#fff0f0', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#c0392b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertCircle size={14} /> Bababa na sa 50 hours! Mag-migrate na o mag-upgrade bago ma-suspend ang app.
                      </div>
                    )}
                  </div>

                  {/* Bandwidth Card */}
                  {r.bandwidthUsedBytes !== undefined && (
                    <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={15} /> Outbound Bandwidth</div>
                      <div style={{ fontSize: 11, color: '#8e8e93', marginBottom: 12 }}>Monthly Included: 100 GB</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: '#1c1c1e', lineHeight: 1 }}>{fmtBytes(r.bandwidthUsedBytes)}</div>
                          <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 2 }}>nagamit</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color: bwColor, lineHeight: 1 }}>{bwPct.toFixed(1)}%</div>
                          <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 2 }}>ng 100 GB</div>
                        </div>
                      </div>
                      <div style={{ background: '#f2f2f7', borderRadius: 99, height: 10, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${bwPct}%`, background: bwColor, borderRadius: 99, transition: 'width 0.6s' }} />
                      </div>
                    </div>
                  )}

                  {/* Services List */}
                  {r.services && r.services.length > 0 && (
                    <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 12 }}><Rocket size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />Render Services</div>
                      {r.services.map((svc, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < r.services.length - 1 ? '1px solid #f2f2f7' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 9, height: 9, borderRadius: '50%', background: svc.status === 'not_suspended' ? '#34C759' : '#ff3b30', boxShadow: svc.status === 'not_suspended' ? '0 0 5px #34C759' : 'none', flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1c1e' }}>{svc.name}</div>
                              <div style={{ fontSize: 11, color: '#8e8e93' }}>{svc.plan} · {svc.region}</div>
                            </div>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: svc.status === 'not_suspended' ? '#1a7f37' : '#c0392b', background: svc.status === 'not_suspended' ? '#f0fff4' : '#fff3f3', borderRadius: 6, padding: '3px 8px' }}>
                            {svc.status === 'not_suspended' ? 'Running' : 'Suspended'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Memory */}
                  <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 12 }}>🧠 Memory Usage</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: '#1c1c1e', lineHeight: 1 }}>{fmtBytes(mem.used)}</div>
                        <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 2 }}>heap used</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: memColor, lineHeight: 1 }}>{memPct}%</div>
                        <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 2 }}>of {fmtBytes(mem.total)}</div>
                      </div>
                    </div>
                    <div style={{ background: '#f2f2f7', borderRadius: 99, height: 10, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ height: '100%', width: `${memPct}%`, background: memColor, borderRadius: 99, transition: 'width 0.6s' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                      <div style={{ background: '#f9f9f9', borderRadius: 10, padding: '8px 12px' }}>
                        <div style={{ fontSize: 11, color: '#8e8e93' }}>RSS (total process)</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#3a3a3c' }}>{fmtBytes(mem.rss)}</div>
                      </div>
                      <div style={{ background: '#f9f9f9', borderRadius: 10, padding: '8px 12px' }}>
                        <div style={{ fontSize: 11, color: '#8e8e93' }}>External</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#3a3a3c' }}>{fmtBytes(mem.external)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Uptime + Requests */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                      <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 4 }}>⏰ Uptime</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#1c1c1e' }}>{serverStats.uptime}</div>
                    </div>
                    <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                      <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 4 }}>📡 Requests</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#1c1c1e' }}>{serverStats.requests.total.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: '#8e8e93' }}>{serverStats.requests.thisHour} this hour</div>
                    </div>
                  </div>

                  {/* DB Status */}
                  <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 12 }}>🗄️ Database</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: serverStats.database.status === 'connected' ? '#34C759' : '#ff3b30', boxShadow: serverStats.database.status === 'connected' ? '0 0 6px #34C759' : 'none' }} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#3a3a3c', textTransform: 'capitalize' }}>{serverStats.database.status}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[
                        { label: 'Batches', value: serverStats.database.batches },
                        { label: 'Images', value: serverStats.database.images },
                        { label: 'Teachers', value: serverStats.database.teachers },
                      ].map((item, i) => (
                        <div key={i} style={{ background: '#f9f9f9', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#1c1c1e' }}>{item.value}</div>
                          <div style={{ fontSize: 11, color: '#8e8e93' }}>{item.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div style={{ background: '#f9f9f9', borderRadius: 14, padding: '12px 16px', fontSize: 12, color: '#8e8e93' }}>
                    Node {serverStats.node.version} · {serverStats.node.platform} · {serverStats.node.env} · Last checked: {new Date(serverStats.timestamp).toLocaleTimeString()}
                  </div>
                </>
              );
            })()}

            {!serverStats && !serverLoading && !serverError && (
              <div style={{ textAlign: 'center', padding: 40, color: '#8e8e93', fontSize: 14 }}>
                {t('tapRefreshHint')}
              </div>
            )}
          </div>
        )}

        {/* ── BARCODE GENERATOR TAB ── */}
        {activeSection === 'barcodes' && <BarcodeGeneratorTab batches={batches} />}

        {activeSection === 'security' && isAdminUser && (
          <div style={{ padding: '4px 2px' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1c1c1e', margin: '4px 0 4px' }}>Change Password</h3>
            <p style={{ fontSize: 13, color: '#8e8e93', margin: '0 0 16px', lineHeight: 1.5 }}>
              Passwords are stored securely on the server. Changing a password immediately signs out everyone currently using that account on every device — they will need to log in again with the new password.
            </p>

            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 8px rgba(0,0,0,0.05)', maxWidth: 460 }}>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Account</label>
                <select
                  value={pwTarget}
                  onChange={e => { setPwTarget(e.target.value); setPwMsg(null); }}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, background: '#fff' }}
                >
                  <option value="">— Select an account —</option>
                  {pwAccounts.map(a => (
                    <option key={a.username} value={a.username}>{a.username} ({a.role})</option>
                  ))}
                </select>
              </div>

              {pwTarget && pwAccounts.find(a => a.username === pwTarget && a.role === 'admin') && (
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Current password (required for admin)</label>
                  <input type="password" value={pwCurrent} onChange={e => { setPwCurrent(e.target.value); setPwMsg(null); }}
                    placeholder="Enter current admin password"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box' }} />
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>New password</label>
                <input type="password" value={pwNew} onChange={e => { setPwNew(e.target.value); setPwMsg(null); }}
                  placeholder="At least 6 characters"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box' }} />
              </div>

              <div className="form-group" style={{ marginBottom: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Confirm new password</label>
                <input type="password" value={pwConfirm} onChange={e => { setPwConfirm(e.target.value); setPwMsg(null); }}
                  placeholder="Re-type new password"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box' }} />
              </div>

              {pwMsg && (
                <p style={{ fontSize: 13, margin: '12px 0 0', color: pwMsg.type === 'ok' ? '#1a7f37' : '#ff3b30', lineHeight: 1.45 }}>
                  {pwMsg.text}
                </p>
              )}

              <button
                onClick={submitChangePassword}
                disabled={pwBusy}
                style={{ width: '100%', marginTop: 16, background: '#8B0000', color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 700, cursor: pwBusy ? 'default' : 'pointer', opacity: pwBusy ? 0.7 : 1 }}>
                {pwBusy ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </div>
        )}

      </div>
      <style>{`@keyframes dotPulse { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1.25)} }`}</style>
    </div>
  );
}

// ── SMART REMINDERS COMPONENT ────────────────────────────────────────────────
function SmartReminders({ batches, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sage_dismissed_reminders') || '[]'); } catch { return []; }
  });

  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Compute reminders across all batches
  const reminders = [];

  batches.forEach(batch => {
    batch.students
      .filter(s => !s.isArchived)
      .forEach(student => {
        // ── Exam reminder: no exam entry in last 30 days ──────────────────
        let latestExamDate = null;
        (student.categories || []).forEach(cat => {
          (cat.items || []).forEach(item => {
            if (item.date) {
              const d = new Date(item.date);
              if (!latestExamDate || d > latestExamDate) latestExamDate = d;
            }
          });
        });

        const hasNoRecentExam = !latestExamDate || latestExamDate < cutoff30;
        if (hasNoRecentExam) {
          const id = `exam-${batch._id}-${student._id}`;
          const daysSince = latestExamDate
            ? Math.floor((now - latestExamDate) / (1000 * 60 * 60 * 24))
            : null;
          reminders.push({
            id,
            type: 'exam',
            student: student.name,
            batch: batch.name,
            batchObj: batch,
            studentObj: student,
            daysSince,
            label: daysSince
              ? `No exam for ${daysSince} days`
              : 'No exam recorded yet',
          });
        }
      });
  });

  // Filter out dismissed
  const active = reminders.filter(r => !dismissed.includes(r.id));
  const examReminders = active.filter(r => r.type === 'exam');

  if (active.length === 0) return null;

  const dismiss = (id, e) => {
    e.stopPropagation();
    const next = [...dismissed, id];
    setDismissed(next);
    try { localStorage.setItem('sage_dismissed_reminders', JSON.stringify(next)); } catch {}
  };

  const dismissAll = () => {
    const next = [...dismissed, ...active.map(r => r.id)];
    setDismissed(next);
    try { localStorage.setItem('sage_dismissed_reminders', JSON.stringify(next)); } catch {}
  };

  const urgentCount = active.filter(r => r.daysSince === null || r.daysSince >= 45).length;
  const bannerColor = urgentCount > 0
    ? 'linear-gradient(135deg, #c0392b, #e74c3c)'
    : 'linear-gradient(135deg, #e67e22, #f39c12)';

  return (
    <div style={{ margin: '12px 16px 0', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Collapsed banner */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          background: bannerColor,
          borderRadius: expanded ? '14px 14px 0 0' : 14,
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer',
          boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
          transition: 'border-radius 0.2s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔔</span>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
              Smart Reminders
            </div>
            <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>
              {active.length} student{active.length !== 1 ? 's' : ''} need attention
              {urgentCount > 0 && ` · ${urgentCount} urgent`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            background: 'rgba(255,255,255,0.25)',
            borderRadius: 20, minWidth: 26, height: 26,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 13,
          }}>
            {active.length}
          </div>
          <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 18, transition: 'transform 0.2s', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'none' }}>
            ›
          </span>
        </div>
      </div>

      {/* Expanded list */}
      {expanded && (
        <div style={{
          background: 'var(--bg-card, #fff)',
          borderRadius: '0 0 14px 14px',
          border: '1px solid var(--border-color, #e5e5ea)',
          borderTop: 'none',
          overflow: 'hidden',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}>
          {/* Section header */}
          <div style={{
            padding: '10px 16px 6px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-color, #f0f0f0)',
          }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary, #8e8e93)', letterSpacing: 0.3, display: 'flex', alignItems: 'center', gap: 5 }}>
                <AlertTriangle size={12} /> NO EXAM IN 30+ DAYS — {examReminders.length}
              </span>
            <button
              onClick={dismissAll}
              style={{
                background: 'none', border: 'none', color: '#8e8e93',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '2px 6px',
              }}
            >
              Clear all
            </button>
          </div>

          {examReminders.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary, #8e8e93)', fontSize: 13 }}>
              All caught up! ✓
            </div>
          )}

          {examReminders.map((r, i) => {
            const isUrgent = r.daysSince === null || r.daysSince >= 45;
            return (
              <div
                key={r.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: i < examReminders.length - 1 ? '1px solid var(--border-color, #f5f5f7)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                  cursor: onNavigate ? 'pointer' : 'default',
                  background: isUrgent ? 'rgba(255,59,48,0.03)' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onClick={() => onNavigate && onNavigate(r.batchObj, r.studentObj)}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                  background: isUrgent ? '#fff0f0' : '#fff8ee',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isUrgent
                    ? <AlertCircle size={18} color="#ff3b30" />
                    : <AlertTriangle size={18} color="#ff9500" />
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 700,
                    color: 'var(--text-primary, #1c1c1e)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {r.student}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary, #8e8e93)', marginTop: 2 }}>
                    <BookOpen size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />{r.batch} · {r.label}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isUrgent && (
                    <span style={{
                      background: '#ff3b30', color: '#fff',
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                    }}>
                      URGENT
                    </span>
                  )}
                  <button
                    onClick={(e) => dismiss(r.id, e)}
                    style={{
                      background: 'rgba(0,0,0,0.06)', border: 'none',
                      borderRadius: '50%', width: 24, height: 24,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, color: '#8e8e93', flexShrink: 0,
                    }}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          <div style={{
            padding: '10px 16px', background: 'var(--bg-secondary, #f9f9f9)',
            borderTop: '1px solid var(--border-color, #f0f0f0)',
            fontSize: 11, color: 'var(--text-tertiary, #8e8e93)', textAlign: 'center',
          }}>
            Tap a student to go to their profile · Dismissals reset on next session
          </div>
        </div>
      )}
    </div>
  );
}

// ── LOGIN SCREEN ─────────────────────────────────────────────────────────────
// NOTE: Credentials are no longer stored here. Authentication is handled by the
// server (POST /api/auth/login). The frontend never sees any password.
const AUTH_KEY = 'sage_auth';
const ROLE_KEY = 'sage_role'; // 'admin' or 'viewer'
const TOKEN_KEY = 'sage_token'; // server-issued session token

const TEACHER_KEY = 'sage_teacher';

// ── TEACHER SELECT SCREEN ─────────────────────────────────────────────────────
function TeacherSelect({ onSelect }) {
  const [teachers, setTeachers] = useState([]);
  const [loadingT, setLoadingT] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('👩\u200d🏫');
  const [saving, setSaving] = useState(false);
  const [showProgressChart, setShowProgressChart] = useState(false);
  const [progressChartStudent, setProgressChartStudent] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [globalQuery, setGlobalQuery] = useState('');
  const [allBatches, setAllBatches] = useState([]);
  const EMOJIS = ['\u{1F469}\u200d\u{1F3EB}','\u{1F468}\u200d\u{1F3EB}','\u{1F469}','\u{1F468}','\u{1F9D1}\u200d\u{1F3EB}'];

  const [refreshing, setRefreshing] = useState(false);
  const refreshAllBatches = () => {
    setRefreshing(true);
    fetch(`${API}/batches`)
      .then(r => r.json())
      .then(data => {
        setAllBatches(Array.isArray(data) ? data : []);
        setRefreshing(false);
      })
      .catch(() => setRefreshing(false));
  };

  useEffect(() => {
    fetch(`${API}/teachers`)
      .then(r => r.json())
      .then(data => { setTeachers(data); setLoadingT(false); })
      .catch(() => setLoadingT(false));
    // Fetch ALL batches for global search (no teacher filter)
    refreshAllBatches();
  }, []);

  // Global search across ALL teachers and batches
  const searchResults = globalQuery.trim().length >= 1 ? (() => {
    const q = globalQuery.trim().toLowerCase();
    const results = [];
    allBatches.forEach(batch => {
      batch.students
        .filter(s => !s.isArchived)
        .forEach(s => {
          if (
            s.name?.toLowerCase().includes(q) ||
            s.companyName?.toLowerCase().includes(q) ||
            s.kumiai?.toLowerCase().includes(q) ||
            batch.name?.toLowerCase().includes(q)
          ) {
            results.push({ student: s, batch, isHiddenBatch: !!batch.isHiddenFromViewer });
          }
        });
    });
    return results.sort((a, b) => a.student.name.localeCompare(b.student.name));
  })() : null;

  const addTeacher = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch(`${API}/teachers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), emoji: newEmoji })
    });
    const t = await res.json();
    setTeachers(prev => [...prev, t]);
    setNewName(''); setShowAdd(false); setSaving(false);
  };

  const deleteTeacher = async (id) => {
    await fetch(`${API}/teachers/${id}`, { method: 'DELETE' });
    setTeachers(prev => prev.filter(t => t._id !== id));
    setDeleteId(null);
  };

  const uploadSignature = async (teacherId, file) => {
    const compressed = await compressImage(file, 600, 0.7);
    const res = await fetch(`${API}/teachers/${teacherId}/signature`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: compressed })
    });
    const updated = await res.json();
    setTeachers(prev => prev.map(t => t._id === teacherId ? updated : t));
  };

  const uploadTeacherPhoto = async (teacherId, file) => {
    const compressed = await compressImage(file, 400, 0.8);
    const res = await fetch(`${API}/teachers/${teacherId}/photo`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: compressed })
    });
    const updated = await res.json();
    setTeachers(prev => prev.map(tc => tc._id === teacherId ? { ...tc, photo: updated.photo } : tc));
  };

  return (
    <div className="tc-screen">
      <div className="tc-header">
        <img src={LOGO_DATA_URL} alt="Sage Asian" className="tc-logo" />
        <h2 className="tc-title">{t('selectTeacher')}</h2>
        <p className="tc-subtitle">{t('tapNameToContinue')}</p>
      </div>

      {/* ── Global Search Bar ── */}
      <div className="tc-search-row">
        <div className="tc-search-wrap">
          <Search size={16} className="tc-search-icon" />
          <input
            type="text"
            className="tc-search-input"
            value={globalQuery}
            onChange={e => setGlobalQuery(e.target.value)}
            onFocus={refreshAllBatches}
            placeholder="Search any student across all teachers..."
          />
          {globalQuery && (
            <button onClick={() => setGlobalQuery('')} className="tc-search-clear"><X size={14} /></button>
          )}
        </div>
        <button onClick={refreshAllBatches} className="tc-refresh-btn" title="Refresh">
          <RefreshCw size={15} className={refreshing ? 'tc-spin' : ''} />
        </button>
      </div>

      {/* ── Search Results ── */}
      {searchResults !== null && (
        <div className="tc-results">
          <p className="tc-results-count">
            {searchResults.length === 0
              ? `No results for "${globalQuery}"`
              : `${searchResults.length} student${searchResults.length !== 1 ? 's' : ''} found`}
          </p>
          {searchResults.length === 0 ? (
            <div className="tc-empty-mini">No students found</div>
          ) : (
            <div className="tc-list">
              {searchResults.map(({ student, batch, isHiddenBatch }) => {
                const teacher = teachers.find(tc => tc._id === batch.teacherId);
                const isOrphaned = !teacher;
                return (
                  <button
                    key={student._id}
                    onClick={() => { if (!isOrphaned) onSelect(teacher, student, batch); }}
                    disabled={isOrphaned}
                    title={isOrphaned ? 'Hindi na ma-access ang student na ito — maaaring na-delete na ang teacher o batch' : undefined}
                    className={`tc-result-row${isOrphaned ? ' tc-result-row--orphaned' : ''}`}
                  >
                    <div className="tc-result-avatar">
                      {student.photo
                        ? <img src={student.photo} alt={student.name} />
                        : student.name?.[0]?.toUpperCase()}
                    </div>
                    <div className="tc-result-info">
                      <div className="tc-result-name">
                        {student.name}
                        {isOrphaned && <span className="tc-badge tc-badge--danger">Unavailable</span>}
                        {!isOrphaned && isHiddenBatch && <span className="tc-badge tc-badge--warn">Hidden from PHGIC</span>}
                      </div>
                      <div className="tc-result-meta">
                        <BookOpen size={11} />{batch.name}{teacher ? ` · ${teacher.emoji || '👩‍🏫'} ${teacher.name}` : isOrphaned ? ' · Teacher/batch no longer exists' : ''}
                      </div>
                    </div>
                    <span className="tc-chevron">{isOrphaned ? '⚠️' : '›'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="tc-list">
        {loadingT && <p className="loading-text">{t('loading')}</p>}
        {teachers.map(teacher => (
          <div key={teacher._id} className="tc-card">
            <button onClick={() => onSelect(teacher)} className="tc-card-main">
              <label onClick={e => e.stopPropagation()} className="tc-avatar-label" title="Tap to change photo">
                {teacher.photo
                  ? <img src={teacher.photo} alt={teacher.name} className="tc-avatar-photo" />
                  : <span className="tc-avatar-emoji">{teacher.emoji}</span>
                }
                <span className="tc-avatar-camera"><Camera size={10} /></span>
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => e.target.files[0] && uploadTeacherPhoto(teacher._id, e.target.files[0])} />
              </label>
              <div className="tc-card-text">
                <span className="tc-card-name">{teacher.name}</span>
                <span className="tc-card-sub">
                  {teacher.signature ? <><Check size={11} /> Signature saved</> : 'No signature yet'}
                </span>
              </div>
              <span className="tc-chevron">›</span>
            </button>

            <div className="tc-card-menu-wrap">
              <button
                className="tc-menu-btn"
                onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === teacher._id ? null : teacher._id); }}
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpenId === teacher._id && (
                <>
                  <div className="tc-menu-backdrop" onClick={() => setMenuOpenId(null)} />
                  <div className="tc-menu-dropdown">
                    <label className="tc-menu-item">
                      <PenLine size={14} /> Upload signature
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => { e.target.files[0] && uploadSignature(teacher._id, e.target.files[0]); setMenuOpenId(null); }} />
                    </label>
                    <button className="tc-menu-item tc-menu-item--danger"
                      onClick={() => { setDeleteId(teacher._id); setMenuOpenId(null); }}>
                      <Trash2 size={14} /> {t('delete') || 'Delete'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {deleteId === teacher._id && (
              <div className="tc-delete-confirm-inline">
                <span>Tanggalin si {teacher.name}?</span>
                <div className="tc-delete-actions">
                  <button onClick={() => deleteTeacher(teacher._id)} className="tc-btn-danger-sm">Delete</button>
                  <button onClick={() => setDeleteId(null)} className="tc-btn-cancel-sm">{t('cancel')}</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {showAdd ? (
          <div className="tc-add-form">
            <p className="tc-add-form-title">{t('chooseEmoji')}</p>
            <div className="emoji-row" style={{ marginBottom: 14 }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => setNewEmoji(e)} className={`emoji-btn${newEmoji === e ? ' selected' : ''}`}>{e}</button>
              ))}
            </div>
            <input
              type="text" className="sk-input" style={{ marginBottom: 14 }}
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder={t('teacherName')} autoFocus
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={addTeacher} disabled={saving || !newName.trim()} className="sk-btn-primary" style={{ fontSize: 14, padding: 12 }}>
                {saving ? t('saving') : t('addTeacherLabel')}
              </button>
              <button onClick={() => { setShowAdd(false); setNewName(''); }} className="tc-btn-cancel-sm" style={{ flex: 1 }}>{t('cancel')}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} className="tc-add-card">
            <span className="tc-add-icon">+</span> {t('addTeacher')}
          </button>
        )}
      </div>

      <button onClick={() => { safeLocalRemove(AUTH_KEY); safeLocalRemove(TOKEN_KEY); safeLocalRemove(TEACHER_KEY); window.location.reload(); }}
        className="tc-logout-btn">
        {t('logout')}
      </button>

      {showProgressChart && progressChartStudent && (
        <ProgressChart
          student={progressChartStudent}
          batch={null}
          onClose={() => { setShowProgressChart(false); setProgressChartStudent(null); }}
        />
      )}
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef(null);

  const handleLogin = async () => {
    if (!username || !password) { setError('Please enter your username and password.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setError(data.error || 'Invalid username or password.');
        return;
      }
      safeLocalSet(AUTH_KEY, 'true');
      safeLocalSet(ROLE_KEY, data.role);
      safeLocalSet(TOKEN_KEY, data.token);
      if (data.lang) safeLocalSet('sage_lang', data.lang);
      onLogin(data.role);
    } catch (e) {
      setError('Cannot reach the server. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sk-login-screen">
      <div className="sk-login-card">
        <img src={LOGO_DATA_URL} alt="Sage Asian" className="sk-login-logo" />
        <div className="sk-wordmark">
          <span className="sk-wordmark-sage">SAGE</span>
          <span className="sk-wordmark-place">BULACAN</span>
        </div>
        <h2 className="sk-login-title">{t('welcomeBack')}</h2>
        <p className="sk-login-subtitle">Sign in to continue to SAGE Bulacan</p>

        <div className="sk-form-group">
          <label className="sk-label">{t('username')}</label>
          <input
            type="text"
            className="sk-input"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && passwordRef.current?.focus()}
            placeholder="Enter username"
          />
        </div>
        <div className="sk-form-group">
          <label className="sk-label">{t('password')}</label>
          <div className="sk-password-wrapper">
            <input
              ref={passwordRef}
              type={showPass ? 'text' : 'password'}
              className="sk-input"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Enter password"
            />
            <button onClick={() => setShowPass(p => !p)} className="sk-password-toggle" type="button">
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {error && <p className="sk-error-text">{error}</p>}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="sk-btn-primary"
          style={{ opacity: loading ? 0.7 : 1 }}
        >
          {loading ? '…' : t('login')}
        </button>
      </div>
    </div>
  );
}

// ── MAIN APP ────────────────────────────────────────────────────────────────

const LOGO_DATA_URL = "data:image/png;base64,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";

function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState('enter');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 800);
    const t2 = setTimeout(() => setPhase('exit'), 2300);
    const t3 = setTimeout(() => onDone && onDone(), 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const logoStyle = {
    enter: { opacity: 0, transform: 'scale(0.80) translateY(6px)' },
    hold:  { opacity: 1, transform: 'scale(1) translateY(0)' },
    exit:  { opacity: 0, transform: 'scale(1.06) translateY(-4px)' },
  }[phase];

  return (
    <div className="sk-splash" style={{
      opacity: phase === 'exit' ? 0 : 1,
      transition: phase === 'exit' ? 'opacity 0.55s ease-in-out' : 'none',
    }}>


      <div className="sk-splash-card">
        <img
          src={LOGO_DATA_URL}
          alt="Sage Asian"
          className="sk-splash-logo"
          style={{
            opacity: logoStyle.opacity,
            transform: logoStyle.transform,
            transition: phase === 'enter'
              ? 'opacity 0.8s cubic-bezier(0.22,1,0.36,1), transform 0.8s cubic-bezier(0.22,1,0.36,1)'
              : phase === 'exit'
              ? 'opacity 0.45s ease-in, transform 0.45s ease-in'
              : 'none',
          }}
        />
        <div className="sk-wordmark sk-wordmark--splash" style={{ opacity: logoStyle.opacity }}>
          <span className="sk-wordmark-sage">SAGE</span>
          <span className="sk-wordmark-place">BULACAN</span>
        </div>
        <p className="sk-splash-tagline" style={{ opacity: phase === 'hold' ? 1 : 0 }}>
          Student Assessment &amp; Grade Evaluation
        </p>
      </div>

      <div className="sk-splash-dots" style={{ opacity: phase === 'hold' ? 1 : 0 }}>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="sk-splash-dot"
            style={{ animation: phase === 'hold' ? `skDotPulse 1.1s ease-in-out ${i * 0.18}s infinite` : 'none' }}
          />
        ))}
      </div>
    </div>
  );
}

// ── PARENT QR POPUP ────────────────────────────────────────────────────────────
function ParentQRPopup({ student, batch, teacher, onClose }) {
  const [expiresAt, setExpiresAt] = useState(() => {
    // Default: 7 days from now
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [generating, setGenerating] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [error, setError] = useState('');

  const generate = async () => {
    setGenerating(true); setError(''); setQrDataUrl(null); setTokenInfo(null);
    try {
      const expiry = new Date(expiresAt);
      expiry.setHours(23, 59, 59, 999); // end of chosen day
      const res = await fetch(`${API}/parent-token/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: batch._id,
          studentId: student._id,
          expiresAt: expiry.toISOString(),
          createdBy: teacher?.name || 'Admin',
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const url = `${window.location.origin}/open.html?view=${data.token}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 360, margin: 2 });
      setQrDataUrl(dataUrl);
      setTokenInfo({ url, expiresAt: new Date(data.expiresAt) });
    } catch (err) {
      setError(err.message);
    }
    setGenerating(false);
  };

  const copyLink = () => {
    if (tokenInfo?.url) {
      navigator.clipboard.writeText(tokenInfo.url).then(() => alert('Link copied!')).catch(() => {});
    }
  };

  const formatDate = (d) => d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)', borderRadius: '20px 20px 0 0',
          padding: '24px 20px 40px', width: '100%', maxWidth: 480,
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
        }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, background: '#e5e5ea', borderRadius: 2, margin: '0 auto 20px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          {student.photo
            ? <img src={student.photo} alt={student.name} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
            : <span style={{ }}><User size={36} strokeWidth={1.2} /></span>
          }
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #1c1c1e)' }}>{student.name}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-tertiary, #8e8e93)' }}><BookOpen size={12} style={{ marginRight: 5, verticalAlign: "middle" }} />{batch.name}</p>
          </div>
        </div>

        {/* Expiry picker */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #3a3a3c)', display: 'block', marginBottom: 6 }}>
            📅 QR Expiration Date
          </label>
          <input
            type="date"
            value={expiresAt}
            min={new Date().toISOString().split('T')[0]}
            onChange={e => { setExpiresAt(e.target.value); setQrDataUrl(null); setTokenInfo(null); }}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '11px 14px',
              borderRadius: 10, border: '1.5px solid #e5e5ea',
              fontSize: 15, background: 'var(--bg-card, #fff)',
              color: 'var(--text-primary, #1c1c1e)',
            }}
          />
          <p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--text-tertiary, #8e8e93)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertTriangle size={12} /> After this date, the QR code will no longer work.
          </p>
        </div>

        {/* Info box */}
        <div style={{ background: '#f0f7ff', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#1565c0', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Users size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          The parent can view all exam scores and scanned papers of <strong>{student.name}</strong> without logging in. No editing allowed.
        </div>

        {error && (
          <div style={{ background: '#fff3f3', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#c62828', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Generated QR */}
        {qrDataUrl && tokenInfo && (
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              background: '#fff', borderRadius: 16, padding: 16, display: 'inline-block',
              boxShadow: '0 2px 16px rgba(0,0,0,0.1)', marginBottom: 12,
            }}>
              <img src={qrDataUrl} alt="Parent QR Code" style={{ width: 200, height: 200, display: 'block' }} />
            </div>
            <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#2e7d32', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <CheckCircle size={14} color="#2e7d32" /> QR ready to share!
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#8e8e93' }}>
              Expires: <strong>{formatDate(tokenInfo.expiresAt)}</strong>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={copyLink}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10,
                  background: '#007AFF', color: '#fff', border: 'none',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >🔗 Copy Link</button>
              <a
                href={qrDataUrl}
                download={`${student.name}-parent-qr.png`}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10,
                  background: '#34C759', color: '#fff', border: 'none',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  textDecoration: 'none', display: 'flex', alignItems: 'center',
                  justifyContent: 'center',
                }}
              >⬇️ Save QR</a>
            </div>
          </div>
        )}

        <button
          onClick={generate}
          disabled={generating || !expiresAt}
          style={{
            width: '100%', padding: '15px',
            background: generating ? '#e5e5ea' : 'linear-gradient(135deg, #8B0000, #c0392b)',
            color: generating ? '#8e8e93' : '#fff',
            border: 'none', borderRadius: 12,
            fontSize: 16, fontWeight: 700,
            cursor: generating ? 'default' : 'pointer',
          }}
        >
          {generating
            ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 6, verticalAlign: 'middle' }} />Generating...</>
            : qrDataUrl
              ? <><RefreshCw size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Regenerate</>
              : <><KeyRound size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Generate Parent QR</>
          }
        </button>

        <button onClick={onClose} style={{
          width: '100%', marginTop: 10, padding: '13px',
          background: 'none', border: '1.5px solid #e5e5ea',
          borderRadius: 12, fontSize: 15, color: '#8e8e93',
          cursor: 'pointer', fontWeight: 600,
        }}>Cancel</button>
      </div>
    </div>
  );
}

// ── PARENT VIEW PAGE (no login required) ──────────────────────────────────────
function ParentView({ data, token }) {
  const [resolvedImgs, setResolvedImgs] = useState({});
  const [imageViewer, setImageViewer] = useState(null);

  const { student, batch, expiresAt } = data;
  const expiry = new Date(expiresAt);

  // Resolve image IDs to URLs
  useEffect(() => {
    const allIds = [];
    student.categories.forEach(cat =>
      cat.items.forEach(item =>
        (item.images || []).forEach(id => {
          if (id && !id.startsWith('data:') && !id.startsWith('http')) allIds.push(id);
        })
      )
    );
    if (!allIds.length) return;
    fetch(`${API}/images/bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: allIds }),
    }).then(r => r.json()).then(map => setResolvedImgs(map)).catch(() => {});
  }, []);

  const resolveImg = (id) => {
    if (!id) return null;
    if (id.startsWith('data:') || id.startsWith('http')) return id;
    return resolvedImgs[id] || null;
  };

  const formatDate = (d) => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  const daysLeft = Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24));

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', background: '#f2f2f7', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #8B0000, #c0392b)',
        padding: '24px 20px 20px',
        paddingTop: 'env(safe-area-inset-top, 24px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          {student.photo
            ? <img src={student.photo} alt={student.name} style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(255,255,255,0.3)' }} />
            : <span style={{ }}><User size={48} strokeWidth={1.2} /></span>
          }
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#fff' }}>{student.name}</h1>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}><BookOpen size={12} style={{ marginRight: 5, verticalAlign: "middle" }} />{batch.name}</p>
            {student.companyName && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}><Building2 size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />{student.companyName}</p>}
          </div>
        </div>
        {/* Expiry badge */}
        <div style={{
          background: daysLeft <= 1 ? 'rgba(255,59,48,0.25)' : 'rgba(255,255,255,0.15)',
          borderRadius: 10, padding: '8px 14px', fontSize: 12, color: '#fff',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>{daysLeft <= 1 ? <AlertTriangle size={14} /> : <Lock size={14} />}</span>
          <span>
            {daysLeft <= 0 ? 'Expires today' : `View access expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`} · {formatDate(expiry)}
          </span>
        </div>
      </div>

      {/* Read-only badge */}
      <div style={{ background: '#fff', padding: '10px 20px', borderBottom: '1px solid #e5e5ea', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Eye size={14} color="#8e8e93" />
        <span style={{ fontSize: 13, color: '#8e8e93' }}>View only · Shared by Sage Asian Japanese Language School</span>
      </div>

      <div style={{ padding: '16px' }}>
        {student.categories.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#8e8e93' }}>
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}><FileText size={48} strokeWidth={1} /></div>
            <p>No exam records yet.</p>
          </div>
        )}

        {student.categories.map(cat => {
          const items = cat.items || [];
          const avg = items.length
            ? Math.round(items.reduce((s, i) => s + ((i.score / i.totalScore) * 100), 0) / items.length)
            : null;
          return (
            <div key={cat._id} style={{ marginBottom: 20 }}>
              {/* Category header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1c1c1e' }}><Folder size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />{cat.name}</h2>
                {avg !== null && (
                  <span style={{
                    background: avg >= 60 ? '#e8f5e9' : '#ffebee',
                    color: avg >= 60 ? '#2e7d32' : '#c62828',
                    fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                  }}>avg {avg}%</span>
                )}
              </div>

              {items.length === 0 && (
                <p style={{ fontSize: 13, color: '#8e8e93', padding: '10px 0' }}>No exams yet.</p>
              )}

              {items.map(item => {
                const pct = Math.round((item.score / item.totalScore) * 100);
                const pass = pct >= 60;
                const imgs = (item.images || []).map(resolveImg).filter(Boolean);
                return (
                  <div key={item._id} style={{
                    background: '#fff', borderRadius: 14, padding: '14px 16px',
                    marginBottom: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: imgs.length ? 12 : 0 }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1c1c1e' }}>{item.name}</p>
                        {item.date && <p style={{ margin: '3px 0 0', fontSize: 12, color: '#8e8e93' }}>📅 {item.date}</p>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                        <div style={{
                          fontSize: 20, fontWeight: 800,
                          color: pass ? '#2e7d32' : '#c62828',
                        }}>{item.score}<span style={{ fontSize: 13, fontWeight: 500, color: '#8e8e93' }}>/{item.totalScore}</span></div>
                        <div style={{
                          fontSize: 12, fontWeight: 700,
                          background: pass ? '#e8f5e9' : '#ffebee',
                          color: pass ? '#2e7d32' : '#c62828',
                          padding: '2px 8px', borderRadius: 12, marginTop: 2,
                        }}>{pct}%</div>
                      </div>
                    </div>

                    {/* Exam paper thumbnails */}
                    {imgs.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                        {imgs.map((src, i) => (
                          <img
                            key={i}
                            src={src}
                            alt={`Page ${i + 1}`}
                            onClick={() => setImageViewer({ images: imgs, index: i })}
                            style={{
                              width: 80, height: 100, objectFit: 'cover',
                              borderRadius: 8, flexShrink: 0,
                              border: '1px solid #e5e5ea', cursor: 'zoom-in',
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '20px', color: '#c7c7cc', fontSize: 12 }}>
        <img src="data:image/png;base64,iVBORw0KGgo=" alt="" style={{ display: 'none' }} />
        <BookOpen size={13} style={{ marginRight: 6, verticalAlign: "middle" }} />Sage Asian Japanese Language School<br />
        This link expires on {formatDate(expiry)}
      </div>

      {imageViewer && (
        <ImageViewer
          images={imageViewer.images}
          startIndex={imageViewer.index}
          onClose={() => setImageViewer(null)}
        />
      )}
    </div>
  );
}

const BATCH_THEMES = ['sakura', 'fuji', 'torii', 'lantern'];

function BatchThemeArt({ theme }) {
  if (theme === 'fuji') {
    return (
      <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" className="bh-theme-svg">
        <rect width="300" height="140" fill="#fdeef2" />
        <circle cx="238" cy="30" r="15" fill="#B22222" />
        <polygon points="55,122 150,24 245,122" fill="#8f1b1b" />
        <polygon points="118,58 150,24 182,58 166,50 150,38 134,50" fill="#ffffff" />
        <rect x="0" y="122" width="300" height="18" fill="#F6B7C7" opacity="0.55" />
      </svg>
    );
  }
  if (theme === 'torii') {
    return (
      <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" className="bh-theme-svg">
        <rect width="300" height="140" fill="#fdeef2" />
        <circle cx="48" cy="34" r="16" fill="#B22222" opacity="0.22" />
        <rect x="92" y="42" width="12" height="86" fill="#B22222" />
        <rect x="196" y="42" width="12" height="86" fill="#B22222" />
        <rect x="68" y="30" width="164" height="15" fill="#B22222" />
        <rect x="68" y="20" width="164" height="8" fill="#8f1b1b" />
        <rect x="96" y="60" width="108" height="10" fill="#8f1b1b" />
        <rect x="0" y="128" width="300" height="12" fill="#F6B7C7" opacity="0.5" />
      </svg>
    );
  }
  if (theme === 'lantern') {
    return (
      <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" className="bh-theme-svg">
        <rect width="300" height="140" fill="#fdeef2" />
        <circle cx="150" cy="72" r="52" fill="#F6B7C7" opacity="0.45" />
        <ellipse cx="150" cy="75" rx="36" ry="42" fill="#B22222" />
        <rect x="139" y="28" width="22" height="9" fill="#8f1b1b" />
        <rect x="139" y="115" width="22" height="9" fill="#8f1b1b" />
        <line x1="150" y1="12" x2="150" y2="28" stroke="#8f1b1b" strokeWidth="3" />
        <line x1="150" y1="124" x2="150" y2="136" stroke="#8f1b1b" strokeWidth="3" />
        <line x1="122" y1="42" x2="122" y2="108" stroke="#8f1b1b" strokeWidth="1.5" opacity="0.4" />
        <line x1="178" y1="42" x2="178" y2="108" stroke="#8f1b1b" strokeWidth="1.5" opacity="0.4" />
      </svg>
    );
  }
  // sakura (default)
  return (
    <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" className="bh-theme-svg">
      <rect width="300" height="140" fill="#fdeef2" />
      <line x1="10" y1="20" x2="140" y2="80" stroke="#8a5a4a" strokeWidth="4" />
      {[[40, 34], [90, 58], [135, 78], [70, 46]].map(([cx, cy], i) => (
        <g key={i}>
          {[0, 72, 144, 216, 288].map(angle => (
            <ellipse
              key={angle}
              cx={cx + 9 * Math.cos((angle * Math.PI) / 180)}
              cy={cy + 9 * Math.sin((angle * Math.PI) / 180)}
              rx="7" ry="4.5"
              transform={`rotate(${angle} ${cx + 9 * Math.cos((angle * Math.PI) / 180)} ${cy + 9 * Math.sin((angle * Math.PI) / 180)})`}
              fill="#F6B7C7"
            />
          ))}
          <circle cx={cx} cy={cy} r="3" fill="#fff3c4" />
        </g>
      ))}
      <circle cx="240" cy="100" r="3" fill="#F6B7C7" />
      <circle cx="260" cy="30" r="2.5" fill="#F6B7C7" />
      <circle cx="200" cy="115" r="2" fill="#F6B7C7" />
    </svg>
  );
}

function App() {
  const [batches, setBatches] = useState([]);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [batchFilterTab, setBatchFilterTab] = useState('all');
  const [batchSort, setBatchSort] = useState('name');
  const [profileTab, setProfileTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [cloudName, setCloudName] = useState('');
  const [view, setView] = useState('batches');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');
  // ── Move-student-to-another-batch feature ──
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTargetBatchId, setMoveTargetBatchId] = useState('');
  const [moving, setMoving] = useState(false);
  const [allBatchesForMove, setAllBatchesForMove] = useState([]); // ALL batches across every teacher (global)
  const [moveTeacherMap, setMoveTeacherMap] = useState({});       // teacherId -> teacher name (for labelling)
  const [loadingMoveBatches, setLoadingMoveBatches] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [newName, setNewName] = useState('');
  const [newExamName, setNewExamName] = useState('');
  const [newScore, setNewScore] = useState('');
  const [newTotalScore, setNewTotalScore] = useState('');
  const [newStudentPhoto, setNewStudentPhoto] = useState(null);
  const [newStudentStatus, setNewStudentStatus] = useState('Regular');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newKumiai, setNewKumiai] = useState('');
  const [newScholarship, setNewScholarship] = useState('no');
  const [newScholarshipType, setNewScholarshipType] = useState('');
  const [newNameJa, setNewNameJa] = useState('');
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingExam, setEditingExam] = useState(null);
  const [newExamDate, setNewExamDate] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('sage_dark') === 'true'; } catch { return false; }
  });
  const [saving, setSaving] = useState(false);
  const [printQRs, setPrintQRs] = useState(null);
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showQuickAddExam, setShowQuickAddExam] = useState(false);
  const [scanningExamId, setScanningExamId] = useState(null);
  const [imageViewer, setImageViewer] = useState(null); // { images, index }
  const [resolvedImages, setResolvedImages] = useState({}); // imageId -> base64
  const imageCache = useRef({}); // in-memory cache
  const [selectedCategory, setSelectedCategory] = useState(null);
  // ── Exam reorder (long-press drag-and-drop) ───────────────────────────────
  const [reorderMode, setReorderMode] = useState(false);
  const [dragItems, setDragItems] = useState([]);
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const longPressTimer = useRef(null);
  const dragStartY = useRef(null);
  const itemRefs = useRef([]);
  const [evaluations, setEvaluations] = useState([]); // per-student evaluations
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [evalTitle, setEvalTitle] = useState('');
  const [evalDate, setEvalDate] = useState('');
  const [evalFields, setEvalFields] = useState({});
  const [evalSaving, setEvalSaving] = useState(false);
  const [remarksTranslation, setRemarksTranslation] = useState('');
  const [translating, setTranslating] = useState(false);
  const translateTimerRef = useRef(null);
  const [allTeachers, setAllTeachers] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null); // { name, students[] }
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullTriggered, setPullTriggered] = useState(false);
  const pullDistanceRef = useRef(0);
  const pullTriggeredRef = useRef(false);
  const pullRefreshingRef = useRef(false);
  const pullStartY = useRef(null);        // finger Y at touchstart, null = disarmed
  const pullScrollY = useRef(0);          // window.scrollY at touchstart
  const PULL_THRESHOLD = 80;
  const [showSettings, setShowSettings] = useState(false);
  const [showProgressChart, setShowProgressChart] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [progressChartStudent, setProgressChartStudent] = useState(null);
  const [showParentQR, setShowParentQR] = useState(false); // parent QR popup
  const [parentQRStudent, setParentQRStudent] = useState(null);
  const [parentViewToken, setParentViewToken] = useState(null); // token from URL for parent view
  const [parentViewData, setParentViewData] = useState(null); // { student, batch, expiresAt }
  const [isLoggedIn, setIsLoggedIn] = useState(() => safeLocalGet(AUTH_KEY) === 'true');
  const [isViewer, setIsViewer] = useState(() => ['viewer','setouchi','wbc','gyoumusuishin','greenservices','sulop'].includes(safeLocalGet(ROLE_KEY)));
  const [isKazumi, setIsKazumi] = useState(() => safeLocalGet(ROLE_KEY) === 'kazumi');
  const [isStudentView, setIsStudentView] = useState(false);
  const [qrPasswordPrompt, setQrPasswordPrompt] = useState(null); // { batchId, studentId } — pending QR scan awaiting password
  const [qrPassInput, setQrPassInput] = useState('');
  const [qrPassError, setQrPassError] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState(() => {
    const s = safeLocalGet(TEACHER_KEY);
    return s ? JSON.parse(s) : null;
  });

  // ── Smart push notifications (teachers + admin only) ──────────────────────
  usePushNotifications(isLoggedIn, isViewer);

  const fileInputRef = useRef(null);
  const studentPhotoInputRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // ── Parent view via token ─────────────────────────────────────────────
    const token = params.get('view');
    if (token) {
      setParentViewToken(token);
      // Fetch token data from server
      fetch(`${API}/parent-token/${token}`)
        .then(r => r.json())
        .then(data => {
          if (data.valid) setParentViewData(data);
          else setParentViewData({ expired: true });
        })
        .catch(() => setParentViewData({ expired: true }));
      return; // don't proceed with normal auth flow
    }

    const batchId = params.get('batch');
    const studentId = params.get('student');
    const isPhgicScan = params.get('phgic') === '1';
    if (batchId && studentId) {
      if (isPhgicScan) {
        // QR scan — if already logged in (any role), go straight in with their existing role
        const alreadyLoggedIn = safeLocalGet(AUTH_KEY) === 'true';
        if (alreadyLoggedIn) {
          const role = safeLocalGet(ROLE_KEY);
          const viewerRoles = ['viewer','setouchi','wbc','gyoumusuishin','greenservices','sulop'];
          const asViewer = viewerRoles.includes(role);
          setIsLoggedIn(true);
          setIsViewer(asViewer);
          setIsKazumi(role === 'kazumi');
          setPendingDeepLink({ batchId, studentId });
          if (asViewer) fetchBatches(null);
          else {
            const teacher = safeLocalGet(TEACHER_KEY);
            if (teacher) fetchBatches(JSON.parse(teacher)._id);
            else fetchBatches(null);
          }
        } else {
          // Not logged in — show password prompt, store pending link
          setQrPasswordPrompt({ batchId, studentId });
        }
      } else {
        // Admin QR — require login first, then deeplink navigates after auth
        const alreadyLoggedIn = safeLocalGet(AUTH_KEY) === 'true';
        setPendingDeepLink({ batchId, studentId });
        if (alreadyLoggedIn) {
          setIsLoggedIn(true);
          const role = safeLocalGet(ROLE_KEY);
          const teacher = safeLocalGet(TEACHER_KEY);
          setIsViewer(['viewer','setouchi','wbc','gyoumusuishin','greenservices','sulop'].includes(role));
          if (['viewer','setouchi','wbc','gyoumusuishin','greenservices','sulop'].includes(role)) {
            fetchBatches(null);
          } else if (teacher) {
            fetchBatches(JSON.parse(teacher)._id);
          } else {
            fetchBatches(null);
          }
        }
        // If not logged in, LoginScreen will show — after login pendingDeepLink will auto-navigate
      }
    } else {
      const isAuth = safeLocalGet(AUTH_KEY) === 'true';
      const role = safeLocalGet(ROLE_KEY);
      if (isAuth && ['viewer','setouchi','wbc','gyoumusuishin','greenservices','sulop'].includes(role)) {
        fetchBatches(null);
      } else {
        const saved = safeLocalGet(TEACHER_KEY);
        const teacher = saved ? JSON.parse(saved) : null;
        if (isAuth && teacher) {
          fetchBatches(teacher._id);
        }
      }
    }
  }, []);

  // ── SESSION VALIDATION ──────────────────────────────────────────────────────
  // On load, confirm the stored token is still valid with the server. If the
  // password was changed (token rotated) or the token is missing/expired, the
  // session is cleared and the user is sent back to the login screen.
  useEffect(() => {
    const isAuth = safeLocalGet(AUTH_KEY) === 'true';
    if (!isAuth) return;
    const token = safeLocalGet(TOKEN_KEY);
    const forceLogout = () => {
      safeLocalRemove(AUTH_KEY);
      safeLocalRemove(ROLE_KEY);
      safeLocalRemove(TOKEN_KEY);
      safeLocalRemove(TEACHER_KEY);
      setIsLoggedIn(false);
      setIsViewer(false);
      setIsKazumi(false);
      setBatches([]);
    };
    // Legacy session created before server auth existed → require fresh login
    if (!token) { forceLogout(); return; }
    fetch(`${API}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('invalid'))))
      .then(d => {
        if (!d.valid) { forceLogout(); return; }
        if (d.role) safeLocalSet(ROLE_KEY, d.role); // keep role authoritative from server
      })
      .catch(() => forceLogout());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyDarkMode(darkMode);
    try { localStorage.setItem('sage_dark', darkMode); } catch {}
  }, [darkMode]);

  const fetchBatches = async (teacherId) => {
    try {
      setLoading(true);
      // Fetch cloud name for direct Cloudinary uploads
      if (!cloudName) {
        fetch(`${API}/config`).then(r => r.json()).then(d => { if (d.cloudName) setCloudName(d.cloudName); }).catch(() => {});
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const url = teacherId ? `${API}/batches?teacherId=${teacherId}` : `${API}/batches`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      // Sort by most recently created first (MongoDB _id contains timestamp)
      data.sort((a, b) => (b._id > a._id ? 1 : -1));
      setBatches(data);
      return data; // allow callers to .then(batches => ...)
      // Fetch all teachers to resolve signatures
      try {
        const tRes = await fetch(`${API}/teachers/with-signatures`);
        const tData = await tRes.json();
        setAllTeachers(tData);
      } catch {}
    } catch (err) {
      if (err.name === 'AbortError') {
        alert('Connection timed out. Please try again.');
      } else {
        alert('Cannot connect to server. Check your internet connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!pendingDeepLink || batches.length === 0) return;
    const { batchId, studentId, openQuickAdd } = pendingDeepLink;
    const batch = batches.find(b => b._id === batchId);
    if (!batch) return;
    const student = batch.students.find(s => s._id === studentId);
    if (!student) return;
    setSelectedBatch(batch);
    setSelectedStudent(student);
    setView('categories');
    setPendingDeepLink(null);
    // If triggered from QR scan, open Quick Add Exam modal
    if (openQuickAdd) setTimeout(() => setShowQuickAddExam(true), 150);
  }, [pendingDeepLink, batches]);

  const updateBatchInState = (updatedBatch) => {
    setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
    if (selectedBatch?._id === updatedBatch._id) setSelectedBatch(updatedBatch);
  };

  // Auto-resolve images whenever examDetail is shown or selectedExam.images changes
  // Fixes: images stuck on "Loading..." when returning to exam or after upload
  useEffect(() => {
    if (view === 'examDetail' && selectedExam?.images?.length) {
      resolveExamImages(selectedExam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedExam?.images?.join(',')]);

  // Resolve image IDs to displayable src — Cloudinary URL or legacy base64
  const resolveImage = async (idOrData) => {
    if (!idOrData) return null;
    // Legacy: already base64
    if (idOrData.startsWith('data:')) return idOrData;
    // Already a Cloudinary URL
    if (idOrData.startsWith('http')) return idOrData;
    // Check in-memory cache
    if (imageCache.current[idOrData]) return imageCache.current[idOrData];
    try {
      const res = await fetch(`${API}/images/${idOrData}`);
      const data = await res.json();
      const src = data.url || data.data || null;
      if (src) {
        imageCache.current[idOrData] = src;
      }
      return src;
    } catch { return null; }
  };

  // Resolve all images for current exam — single bulk request (1 round-trip instead of N)
  const resolveExamImages = async (exam) => {
    if (!exam?.images?.length) return;

    const toFetch = exam.images.filter(
      idOrData =>
        idOrData &&
        !idOrData.startsWith('data:') &&
        !idOrData.startsWith('http') &&
        !imageCache.current[idOrData]
    );

    if (!toFetch.length) return;

    try {
      // Single round-trip: POST /api/images/bulk returns { id: url, ... }
      const res = await fetch(`${API}/images/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: toFetch })
      });
      const map = await res.json();
      Object.entries(map).forEach(([id, url]) => { if (url) imageCache.current[id] = url; });
      const newEntries = Object.fromEntries(Object.entries(map).filter(([, url]) => url != null));
      if (Object.keys(newEntries).length > 0) {
        setResolvedImages(prev => ({ ...prev, ...newEntries }));
      }
    } catch {
      // Fallback: resolve individually if bulk endpoint unavailable
      const results = await Promise.all(
        toFetch.map(async (idOrData) => [idOrData, await resolveImage(idOrData)])
      );
      const newEntries = Object.fromEntries(results.filter(([, url]) => url != null));
      if (Object.keys(newEntries).length > 0) {
        setResolvedImages(prev => ({ ...prev, ...newEntries }));
      }
    }
  };

  const goToStudents = (batch) => { setSelectedBatch(batch); setView('students'); };
  const goToCategories = (student) => {
    // Always resolve the freshest student from selectedBatch so categories/exams are current
    const freshStudent = selectedBatch?.students.find(s => s._id === student._id) || student;
    setSelectedStudent(freshStudent);
    setProfileTab('profile');
    setView('categories');
  };
  const goToExamItems = (cat) => { setSelectedCategory(cat); setView('examItems'); };
  const goToExamDetail = (exam) => { setSelectedExam(exam); setView('examDetail'); resolveExamImages(exam); };
  const goToEvaluations = () => { fetchEvaluations(); setView('evaluations'); };
  const goToEvaluationDetail = (ev) => {
    setSelectedEvaluation(ev);
    setEvalFields(ev.fields || {});
    setView('evaluationDetail');
  };

  const fetchEvaluations = async () => {
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/evaluations`);
      const data = await res.json();
      setEvaluations(data);
    } catch { setEvaluations([]); }
  };

  const goBack = () => {
    const role = safeLocalGet(ROLE_KEY);
    const isKumiai = ['setouchi','wbc','gyoumusuishin','greenservices'].includes(role);
    if (view === 'examDetail') { setView('examItems'); setSelectedExam(null); }
    else if (view === 'examItems') { setView('categories'); setSelectedCategory(null); }
    else if (view === 'evaluationDetail') { setView('evaluations'); setSelectedEvaluation(null); }
    else if (view === 'evaluations') { setView('categories'); }
    else if (view === 'categories') {
      if (isKumiai) {
        setView('batches'); setSelectedStudent(null); setSelectedBatch(null);
      } else { setView('students'); setSelectedStudent(null); }
    }
    else if (view === 'students') { setView('batches'); setSelectedBatch(null); setGlobalSearch(''); }
  };

  const openModal = (type) => {
    setModalType(type); setShowModal(true);
    setNewName(''); setNewExamName(''); setNewScore(''); setNewTotalScore(''); setNewStudentPhoto(null); setNewCompanyName(''); setNewNameJa(''); setEditingCategory(null); setEditingExam(null); setNewExamDate(''); setNewScholarship('no'); setNewScholarshipType('');
  };
  const openEditStudent = (student, e) => {
    e.stopPropagation();
    setEditingStudent(student);
    setNewName(student.name);
    setNewStudentStatus(student.status || 'Regular');
    setNewStudentPhoto(student.photo || null);
    setNewCompanyName(student.companyName || '');
    setNewKumiai(student.kumiai || '');
    setNewScholarship(student.scholarship || 'no');
    setNewScholarshipType(student.scholarshipType || '');
    setModalType('editStudent');
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditingStudent(null);
    setEditingCategory(null);
    setEditingExam(null);
    setNewName(''); setNewExamName(''); setNewScore(''); setNewTotalScore(''); setNewStudentPhoto(null); setNewStudentStatus('Regular'); setNewCompanyName(''); setNewKumiai(''); setNewNameJa(''); setNewExamDate(''); setNewScholarship('no'); setNewScholarshipType('');
  };

  // Upload student photo to Cloudinary via server, returns updated batch.
  // This keeps MongoDB lean — only the Cloudinary URL is stored, not raw base64.
  const uploadStudentPhoto = async (batchId, studentId, base64Photo) => {
    const res = await fetch(`${API}/batches/${batchId}/students/${studentId}/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: base64Photo })
    });
    if (!res.ok) throw new Error('Photo upload failed');
    return res.json();
  };

  // Returns true if the photo value is a newly picked local file (base64),
  // as opposed to an already-uploaded Cloudinary URL from a previous save.
  const isNewPhoto = (photo) => photo && photo.startsWith('data:');

  const updateStudent = async () => {
    if (!newName || !editingStudent) return;
    setSaving(true);
    try {
      // Step 1: save name/status/etc. — photo handled separately below
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${editingStudent._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, status: newStudentStatus, companyName: newCompanyName, kumiai: newKumiai, scholarship: newScholarship, scholarshipType: newScholarship === 'yes' ? newScholarshipType : '' })
      });
      let updatedBatch = await res.json();
      // Step 2: only upload if user picked a NEW photo (base64) — skip if it's already a Cloudinary URL
      if (isNewPhoto(newStudentPhoto)) {
        updatedBatch = await uploadStudentPhoto(selectedBatch._id, editingStudent._id, newStudentPhoto);
      }
      updateBatchInState(updatedBatch);
      closeModal();
    } catch (err) { alert('Error updating student: ' + (err.message || '')); }
    setSaving(false);
  };

  const saveBatch = async () => {
    if (!newName) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, name_ja: newNameJa, teacherId: selectedTeacher?._id || null })
      });
      const newBatch = await res.json();
      setBatches(prev => [newBatch, ...prev]);
      closeModal();
    } catch { alert('Error saving batch.'); }
    setSaving(false);
  };

  const saveStudent = async () => {
    if (!newName || !selectedBatch) return;
    setSaving(true);
    try {
      // Step 1: create student without photo first (gets an _id back)
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, status: newStudentStatus, companyName: newCompanyName, kumiai: newKumiai, scholarship: newScholarship, scholarshipType: newScholarship === 'yes' ? newScholarshipType : '' })
      });
      let updatedBatch = await res.json();
      // Step 2: if a new photo was picked, upload to Cloudinary now that we have a studentId
      if (isNewPhoto(newStudentPhoto)) {
        const newStudent = updatedBatch.students[updatedBatch.students.length - 1];
        if (newStudent?._id) {
          updatedBatch = await uploadStudentPhoto(selectedBatch._id, newStudent._id, newStudentPhoto);
        }
      }
      updateBatchInState(updatedBatch);
      closeModal();
    } catch (err) { alert('Error saving student: ' + (err.message || '')); }
    setSaving(false);
  };

  const saveCategory = async () => {
    if (!newName || !selectedStudent) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, name_ja: newNameJa })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) setSelectedStudent(updatedStudent);
      closeModal();
    } catch { alert('Error saving category.'); }
    setSaving(false);
  };

  const saveExamItem = async () => {
    if (!newExamName || !newScore || !newTotalScore || !selectedCategory) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newExamName, name_ja: newNameJa, score: parseInt(newScore), totalScore: parseInt(newTotalScore) })
      });
      const newItem = await res.json();
      // Update state locally — no need to reload the whole batch
      const updatedCat = { ...selectedCategory, items: [...(selectedCategory.items || []), newItem] };
      const updatedStudent = {
        ...selectedStudent,
        categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c)
      };
      const updatedBatch = {
        ...selectedBatch,
        students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s)
      };
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(updatedBatch);
      setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
      closeModal();
    } catch { alert('Error saving exam.'); }
    setSaving(false);
  };

  const deleteBatch = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this batch?')) return;
    try {
      await fetch(`${API}/batches/${id}`, { method: 'DELETE' });
      setBatches(prev => prev.filter(b => b._id !== id));
    } catch { alert('Error deleting batch.'); }
  };

  const deleteStudent = async (studentId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this student?')) return;
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${studentId}`, { method: 'DELETE' });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
    } catch { alert('Error deleting student.'); }
  };

  // Open the move modal and load EVERY batch (all teachers), not just the current teacher's
  const openMoveModal = async () => {
    setMoveTargetBatchId('');
    setShowMoveModal(true);
    setLoadingMoveBatches(true);
    try {
      const [bRes, tRes] = await Promise.all([
        fetch(`${API}/batches`),   // no teacherId → global list of all batches
        fetch(`${API}/teachers`),
      ]);
      const bData = await bRes.json();
      setAllBatchesForMove(Array.isArray(bData) ? bData : []);
      try {
        const tData = await tRes.json();
        const map = {};
        (Array.isArray(tData) ? tData : []).forEach(tc => { map[tc._id] = tc.name; });
        setMoveTeacherMap(map);
      } catch {}
    } catch {
      // Fallback: at least show whatever is already loaded for this teacher
      setAllBatchesForMove(batches);
    } finally {
      setLoadingMoveBatches(false);
    }
  };

  const moveStudent = async () => {
    if (!moveTargetBatchId) { alert('Please pick a destination batch first.'); return; }
    if (moveTargetBatchId === selectedBatch._id) { alert('Student is already in this batch.'); return; }
    const target = batches.find(b => b._id === moveTargetBatchId);
    if (!window.confirm(`Move ${selectedStudent.name} (with all records, exams, and images) to "${target?.name || 'the selected batch'}"?`)) return;
    setMoving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetBatchId: moveTargetBatchId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert('Error: ' + (data.error || 'Could not move student.')); return; }
      // Replace BOTH affected batches in local state
      setBatches(prev => prev.map(b =>
        b._id === data.sourceBatch._id ? data.sourceBatch
          : b._id === data.targetBatch._id ? data.targetBatch
            : b
      ));
      // Keep viewing the source batch's student list (student is gone from here now)
      setSelectedBatch(data.sourceBatch);
      setSelectedStudent(null);
      setShowMoveModal(false);
      setMoveTargetBatchId('');
      setView('students');
      alert(`✅ ${data.targetBatch.students.find(s => s._id === selectedStudent._id)?.name || 'Student'} moved to "${data.targetBatch.name}".`);
    } catch (e) {
      alert('Failed: ' + e.message);
    } finally {
      setMoving(false);
    }
  };

  const toggleStudentStatus = async (student, e) => {
    e.stopPropagation();
    const newStatus = student.status === 'Selected' ? 'Regular' : 'Selected';
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${student._id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
    } catch { alert('Error updating status.'); }
  };

  const toggleArchiveStudent = async (student) => {
    const newArchived = !student.isArchived;
    const label = newArchived ? 'archive' : 'unarchive';
    if (!window.confirm(`${newArchived ? 'Archive' : 'Unarchive'} ${student.name}? ${newArchived ? 'They will no longer appear on the Kumiai side.' : 'They will be visible again on the Kumiai side.'}`)) return;
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${student._id}/archive`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: newArchived })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === student._id);
      if (updatedStudent) setSelectedStudent(updatedStudent);
    } catch { alert(`Error: could not ${label} student.`); }
  };

  const deleteCategory = async (catId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this category and all its exams?')) return;
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${catId}`, { method: 'DELETE' });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) setSelectedStudent(updatedStudent);
    } catch { alert('Error deleting category.'); }
  };

  const updateCategory = async () => {
    if (!newName || !editingCategory) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${editingCategory._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, name_ja: newNameJa })
      });
      const updatedBatch = await res.json();
      updateBatchInState(updatedBatch);
      const updatedStudent = updatedBatch.students.find(s => s._id === selectedStudent._id);
      if (updatedStudent) setSelectedStudent(updatedStudent);
      closeModal();
    } catch { alert('Error updating category.'); }
    setSaving(false);
  };

  const updateExamItem = async () => {
    if (!newExamName || !editingExam) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/${editingExam._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newExamName, name_ja: newNameJa, score: parseInt(newScore), totalScore: parseInt(newTotalScore), date: newExamDate })
      });
      const updatedItem = await res.json();
      const updatedCat = { ...selectedCategory, items: selectedCategory.items.map(i => i._id === editingExam._id ? { ...i, ...updatedItem } : i) };
      const updatedStudent = { ...selectedStudent, categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c) };
      const updatedBatch = { ...selectedBatch, students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s) };
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(updatedBatch);
      setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
      closeModal();
    } catch { alert('Error updating exam.'); }
    setSaving(false);
  };

  const deleteExamItem = async (itemId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this exam?')) return;
    try {
      await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/${itemId}`, { method: 'DELETE' });
      const updatedCat = { ...selectedCategory, items: selectedCategory.items.filter(i => i._id !== itemId) };
      const updatedStudent = {
        ...selectedStudent,
        categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c)
      };
      const updatedBatch = {
        ...selectedBatch,
        students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s)
      };
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(updatedBatch);
      setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
      if (view === 'examDetail') { setView('examItems'); setSelectedExam(null); }
    } catch { alert('Error deleting exam.'); }
  };

  const deleteExam = deleteExamItem;

  const createEvaluation = async () => {
    if (!evalTitle || !evalDate) return;
    setSaving(true);
    try {
      const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
      const num = evaluations.length;
      const ordinal = ordinals[num] || `${num + 1}th`;
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/evaluations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: evalTitle, ordinal, date: evalDate })
      });
      const newEval = await res.json();
      setEvaluations(prev => [...prev, newEval]);
      setEvalTitle(''); setEvalDate('');
      closeModal();
    } catch { alert('Error creating evaluation.'); }
    setSaving(false);
  };

  const deleteEvaluation = async (evalId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this evaluation?')) return;
    try {
      await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/evaluations/${evalId}`, { method: 'DELETE' });
      setEvaluations(prev => prev.filter(ev => ev._id !== evalId));
    } catch { alert('Error deleting evaluation.'); }
  };

  const saveEvaluationFields = async () => {
    setEvalSaving(true);
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/evaluations/${selectedEvaluation._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: evalFields })
      });
      const updated = await res.json();
      setSelectedEvaluation(updated);
      setEvaluations(prev => prev.map(ev => ev._id === updated._id ? updated : ev));
      alert('Saved!');
    } catch { alert('Error saving evaluation.'); }
    setEvalSaving(false);
  };

  const deleteImagePage = async (examId, index) => {
    if (!window.confirm(`Delete page ${index + 1}?`)) return;
    // Optimistic update — remove from UI immediately
    const updatedExam = { ...selectedExam, images: selectedExam.images.filter((_, i) => i !== index) };
    const updatedCat = { ...selectedCategory, items: selectedCategory.items.map(it => it._id === examId ? updatedExam : it) };
    const updatedStudent = { ...selectedStudent, categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c) };
    const updatedBatch = { ...selectedBatch, students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s) };
    setSelectedExam(updatedExam);
    setSelectedCategory(updatedCat);
    setSelectedStudent(updatedStudent);
    setSelectedBatch(updatedBatch);
    setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
    // Delete from server in background
    fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/${examId}/remove-image`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    }).catch(() => alert('Error deleting page from server.'));
  };

  const uploadImage = async (examId, imageData) => {
    try {
      // Step 1: Direct upload to Cloudinary from browser (fast — no server relay)
      const formData = new FormData();
      // Convert base64 to blob (fast method using fetch)
      const blob = await fetch(imageData).then(r => r.blob());
      formData.append('file', blob, 'image.jpg');
      formData.append('upload_preset', CLOUDINARY_PRESET);
      formData.append('folder', 'sage-bulacan');

      const cName = CLOUDINARY_CLOUD;
      const cdnRes = await fetch(`https://api.cloudinary.com/v1_1/${cName}/image/upload`, {
        method: 'POST', body: formData
      });
      const cdnData = await cdnRes.json();
      if (!cdnData.secure_url) throw new Error('Cloudinary upload failed');

      const imageUrl = cdnData.secure_url;
      const publicId = cdnData.public_id;

      // Step 2: Save URL reference to MongoDB via server (lightweight)
      const imgRes = await fetch(`${API}/images`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imageUrl, publicId })
      });
      const { _id: imageId } = await imgRes.json();

      // Step 3: Store imageId in batch item
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/${examId}/image`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageId })
      });
      const data = await res.json();
      if (!data.success) throw new Error('Upload failed');

      // Cache URL immediately — display is instant
      imageCache.current[imageId] = imageUrl;
      setResolvedImages(prev => ({ ...prev, [imageId]: imageUrl }));

      // Update state locally
      const updatedExam = { ...selectedExam, images: [...(selectedExam?.images || []), imageId] };
      const updatedCat = { ...selectedCategory, items: selectedCategory.items.map(it => it._id === examId ? updatedExam : it) };
      const updatedStudent = { ...selectedStudent, categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c) };
      const updatedBatch = { ...selectedBatch, students: selectedBatch.students.map(s => s._id === selectedStudent._id ? updatedStudent : s) };
      setSelectedExam(updatedExam);
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(updatedBatch);
      setBatches(prev => prev.map(b => b._id === updatedBatch._id ? updatedBatch : b));
    } catch { alert('Error saving image.'); }
  };

  const triggerFileInput = (examId) => {
    fileInputRef.current.setAttribute('data-exam-id', examId);
    fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const examId = fileInputRef.current.getAttribute('data-exam-id');
    const files = Array.from(e.target.files);
    for (const file of files) {
      const compressed = await compressImage(file, 800, 0.55);
      await uploadImage(examId, compressed);
    }
    e.target.value = '';
  };
  const handleQRResult = (url) => {
    setShowQRScanner(false);
    try {
      const u = new URL(url);
      const batchId   = u.searchParams.get('batch');
      const studentId = u.searchParams.get('student');
      const isPhgic   = u.searchParams.get('phgic') === '1';
      if (batchId && studentId && isPhgic) {
        const batch = batches.find(b => b._id === batchId);
        if (batch) {
          const student = batch.students.find(s => s._id === studentId);
          if (student) {
            setSelectedBatch(batch);
            setSelectedStudent(student);
            setView('categories');
            // Open Quick Add Exam modal after navigation
            setTimeout(() => setShowQuickAddExam(true), 150);
            return;
          }
        }
        // Batch not loaded yet — deeplink flow, modal opens after load
        setPendingDeepLink({ batchId, studentId, openQuickAdd: true });
        fetchBatches(isViewer ? null : (safeLocalGet(TEACHER_KEY) ? JSON.parse(safeLocalGet(TEACHER_KEY))._id : null));
      }
    } catch { alert('Invalid QR code.'); }
  };

  const openScanner = (examId) => {
    setScanningExamId(examId);
    setShowScanner(true);
  };

  const handleQuickAddExamSave = async ({ category, examNameEn, examNameJa, score, totalScore, date }) => {
    if (!selectedStudent || !selectedBatch || !category) return;
    try {
      const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${category._id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: examNameEn, name_ja: examNameJa, score, totalScore, date })
      });
      const newItem = await res.json();
      const updatedCat = { ...category, items: [...(category.items || []), newItem] };
      const updatedStudent = {
        ...selectedStudent,
        categories: selectedStudent.categories.map(c => c._id === category._id ? updatedCat : c)
      };
      setSelectedStudent(updatedStudent);
      setBatches(prev => prev.map(b => b._id === selectedBatch._id ? {
        ...b, students: b.students.map(s => s._id === selectedStudent._id ? updatedStudent : s)
      } : b));
      setShowQuickAddExam(false);
      // Navigate directly to the new exam — ready to scan
      setSelectedCategory(updatedCat);
      setSelectedExam(newItem);
      resolveExamImages(newItem);
      setView('examDetail');
    } catch { alert('Error saving exam.'); }
  };

  const handleScanCapture = async (imageDataOrArray) => {
    setShowScanner(false);
    if (!scanningExamId) return;
    const examId = scanningExamId;
    setScanningExamId(null);

    const images = Array.isArray(imageDataOrArray) ? imageDataOrArray : [imageDataOrArray];

    // Track accumulated imageIds locally so each upload sees the latest list,
    // not the stale selectedExam from the React closure
    let accumulatedImageIds = [...(selectedExam?.images || [])];

    for (const imageData of images) {
      try {
        // Step 1: Upload to Cloudinary
        const formData = new FormData();
        const blob = await fetch(imageData).then(r => r.blob());
        formData.append('file', blob, 'image.jpg');
        formData.append('upload_preset', CLOUDINARY_PRESET);
        formData.append('folder', 'sage-bulacan');
        const cdnRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
          method: 'POST', body: formData
        });
        const cdnData = await cdnRes.json();
        if (!cdnData.secure_url) throw new Error('Cloudinary upload failed');

        // Step 2: Save to MongoDB
        const imgRes = await fetch(`${API}/images`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cdnData.secure_url, publicId: cdnData.public_id })
        });
        const { _id: imageId } = await imgRes.json();

        // Step 3: Attach imageId to exam
        const res = await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/${examId}/image`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageId })
        });
        const data = await res.json();
        if (!data.success) throw new Error('Upload failed');

        // Cache and accumulate
        imageCache.current[imageId] = cdnData.secure_url;
        accumulatedImageIds = [...accumulatedImageIds, imageId];

        // Update state with accumulated list so each iteration stacks correctly
        setResolvedImages(prev => ({ ...prev, [imageId]: cdnData.secure_url }));
        setSelectedExam(prev => ({ ...prev, images: accumulatedImageIds }));
        setSelectedCategory(prev => ({
          ...prev,
          items: prev.items.map(it => it._id === examId ? { ...it, images: accumulatedImageIds } : it)
        }));
        setSelectedStudent(prev => ({
          ...prev,
          categories: prev.categories.map(c => c._id === selectedCategory._id
            ? { ...c, items: c.items.map(it => it._id === examId ? { ...it, images: accumulatedImageIds } : it) }
            : c)
        }));
        setSelectedBatch(prev => ({
          ...prev,
          students: prev.students.map(s => s._id === selectedStudent._id
            ? { ...s, categories: s.categories.map(c => c._id === selectedCategory._id
                ? { ...c, items: c.items.map(it => it._id === examId ? { ...it, images: accumulatedImageIds } : it) }
                : c) }
            : s)
        }));
        setBatches(prev => prev.map(b => b._id === selectedBatch._id
          ? { ...b, students: b.students.map(s => s._id === selectedStudent._id
              ? { ...s, categories: s.categories.map(c => c._id === selectedCategory._id
                  ? { ...c, items: c.items.map(it => it._id === examId ? { ...it, images: accumulatedImageIds } : it) }
                  : c) }
              : s) }
          : b));
      } catch { alert('Error saving one of the scanned pages.'); }
    }
  };

  const generateBatchQRs = async () => {
    const studentsToGenerate = isViewer
      ? selectedBatch.students.filter(s => s.status === 'Selected')
      : selectedBatch.students;
    const results = await Promise.all(
      studentsToGenerate.map(async (student) => {
        const url = `${window.location.origin}/open.html?phgic=1&batch=${selectedBatch._id}&student=${student._id}`;
        const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
        return { name: student.name, photo: student.photo, dataUrl };
      })
    );
    setPrintQRs(results);
  };

  // ── Parent view (token-based, no login) ─────────────────────────────────
  if (parentViewToken) {
    if (!parentViewData) return (
      <div style={{ minHeight: '100vh', background: '#f2f2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#8B0000', animation: `dotPulse 1.1s ease-in-out ${i*0.18}s infinite` }} />)}
        </div>
        <p style={{ color: '#8e8e93', fontSize: 14 }}>Loading student record...</p>
        <style>{`@keyframes dotPulse { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1.25)} }`}</style>
      </div>
    );
    if (parentViewData.expired) return (
      <div style={{ minHeight: '100vh', background: '#f2f2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '40px 24px', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center', color: '#8e8e93' }}><Lock size={72} strokeWidth={1.5} /></div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1c1c1e', margin: '0 0 10px' }}>Link Expired</h1>
        <p style={{ fontSize: 15, color: '#8e8e93', margin: 0, lineHeight: 1.6 }}>
          This QR code has expired or is no longer valid.<br />Please ask the teacher to generate a new one.
        </p>
        <div style={{ marginTop: 32, padding: '14px 20px', background: '#fff', borderRadius: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', fontSize: 13, color: '#8e8e93', display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={14} /> Sage Asian Japanese Language School
        </div>
      </div>
    );
    return <ParentView data={parentViewData} token={parentViewToken} />;
  }

  if (showSplash) return (
    <SplashScreen onDone={() => setShowSplash(false)} />
  );

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f2f2f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: 9 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#8B0000', animation: `dotPulse 1.1s ease-in-out ${i*0.18}s infinite` }} />
        ))}
      </div>
      <style>{`@keyframes dotPulse { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1.25)} }`}</style>
    </div>
  );

  // QR scan password prompt — show before anything else if pending
  // QR admin gate — verify the admin password against the server (no password in the client)
  const submitQrPassword = async () => {
    try {
      const res = await fetch(`${API}/auth/check-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin', password: qrPassInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.token) {
        setQrPassError('Incorrect password. Please try again.');
        return;
      }
      safeLocalSet(AUTH_KEY, 'true');
      safeLocalSet(ROLE_KEY, 'admin');
      safeLocalSet(TOKEN_KEY, data.token);
      setIsLoggedIn(true);
      setIsViewer(false);
      setPendingDeepLink(qrPasswordPrompt);
      setQrPasswordPrompt(null);
      setQrPassInput('');
      fetchBatches(null);
    } catch (e) {
      setQrPassError('Cannot reach the server. Please try again.');
    }
  };

  if (qrPasswordPrompt) return (
    <div style={{ minHeight: '100vh', background: '#f2f2f7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center', color: '#8B0000' }}><Lock size={56} strokeWidth={1.5} /></div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1c1c1e', marginBottom: 6, textAlign: 'center' }}>Access Required</h2>
      <p style={{ fontSize: 14, color: '#8e8e93', marginBottom: 28, textAlign: 'center' }}>Enter the password to view this student's record.</p>
      <div style={{ width: '100%', maxWidth: 340, background: '#fff', borderRadius: 16, padding: '20px', boxShadow: '0 2px 16px rgba(0,0,0,0.08)' }}>
        <input
          type="password"
          value={qrPassInput}
          onChange={e => { setQrPassInput(e.target.value); setQrPassError(''); }}
          onKeyDown={e => {
            if (e.key === 'Enter') submitQrPassword();
          }}
          placeholder="Enter password"
          autoFocus
          style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${qrPassError ? '#ff3b30' : '#e5e5ea'}`, fontSize: 16, boxSizing: 'border-box', marginBottom: 10, outline: 'none' }}
        />
        {qrPassError && <p style={{ color: '#ff3b30', fontSize: 13, margin: '0 0 10px', textAlign: 'center' }}>{qrPassError}</p>}
        <button
          onClick={submitQrPassword}
          style={{ width: '100%', background: '#8B0000', color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
          View Record
        </button>
      </div>
    </div>
  );

  // Always require login — no QR scan bypasses auth
  if (!isLoggedIn) return (
    <LoginScreen onLogin={(role) => {
      setIsLoggedIn(true);
      setIsViewer(['viewer','setouchi','wbc','gyoumusuishin','greenservices','sulop'].includes(role));
      setIsKazumi(role === 'kazumi');
      // kazumi sees teacher select then fetches that teacher's batches
      if (['viewer','setouchi','wbc','gyoumusuishin','greenservices','sulop'].includes(role)) fetchBatches(null);
      else if (role !== 'kazumi') {
        const teacher = safeLocalGet(TEACHER_KEY);
        if (teacher) fetchBatches(JSON.parse(teacher)._id);
      }
      // kazumi: wait for TeacherSelect, batches fetched after teacher picked
    }} />
  );

  if ((!isViewer || isKazumi) && !selectedTeacher) return (
    <TeacherSelect onSelect={(t, pendingStudent, pendingBatch) => {
      safeLocalSet(TEACHER_KEY, JSON.stringify(t));
      setSelectedTeacher(t);
      if (pendingStudent && pendingBatch) {
        fetchBatches(t._id).then(loadedBatches => {
          const freshBatch = (loadedBatches || []).find(b => b._id === pendingBatch._id) || pendingBatch;
          const freshStudent = freshBatch.students?.find(s => s._id === pendingStudent._id) || pendingStudent;
          setSelectedBatch(freshBatch);
          setSelectedStudent(freshStudent);
          setView('categories');
        });
      } else {
        fetchBatches(t._id);
      }
    }} />
  );

  const renderCompanyGroups = () => {
    const role = safeLocalGet(ROLE_KEY);
    const kumiai = role === 'setouchi' ? 'Setouchi'
      : role === 'wbc' ? 'WBC'
      : role === 'gyoumusuishin' ? 'Gyoumusuishin'
      : 'Green Services';

    const kumiaiDisplayName = role === 'setouchi' ? 'SETOUCHI TECH COOPERATIVE ASSOCIATION'
      : role === 'wbc' ? 'WORLD BUSINESS COOPERATIVE'
      : role === 'gyoumusuishin' ? 'GYOUMU SUISHIN COOPERATIVE ASSOCIATION'
      : 'Green Services';

    const allStudents = [];
    batches.forEach(batch => {
      batch.students
        .filter(s => !s.isArchived && s.status === 'Selected' && (s.kumiai === kumiai || (!s.kumiai && s.companyName === kumiai)))
        .forEach(s => allStudents.push({ ...s, batchName: batch.name, batchId: batch._id, batch }));
    });

    const groups = {};
    allStudents.forEach(s => {
      const rawCompany = s.companyName;
      const isLegacyKumiai = rawCompany === 'Setouchi' || rawCompany === 'WBC';
      const key = (!rawCompany || isLegacyKumiai) ? t('noCompany') : rawCompany;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });

    const groupKeys = Object.keys(groups).sort();

    // ── Company detail view (students inside a company) ───────────────
    if (selectedCompany) {
      const students = selectedCompany.students.filter(s => !s.isArchived).slice().sort((a, b) => a.name.localeCompare(b.name));
      return (
        <>
          <button className="back-btn" onClick={() => setSelectedCompany(null)}><ArrowLeft size={18} /></button>
          <div className="header-with-back">
            <h1 className="title"><Building2 size={22} style={{ marginRight: 8, verticalAlign: "middle" }} />{selectedCompany.name}</h1>
          </div>
          <h2 className="section-title">{students.length} Student{students.length !== 1 ? 's' : ''}</h2>
          {students.map(student => (
          <div key={student._id} className="card student-card clickable"
            onClick={() => { setSelectedBatch(student.batch); goToCategories(student); }}>
            <div className="card-content">
              <div className="student-card-left">
                {student.photo
                  ? <img src={student.photo} alt={student.name} className="student-avatar"
                      onClick={(e) => { e.stopPropagation(); setImageViewer({ images: [student.photo], index: 0 }); }}
                      style={{ cursor: 'pointer' }} />
                  : <span className="student-avatar-icon"><User size={22} /></span>
                }
                <div>
                  <h3 className="card-title" style={{ margin: 0 }}>{student.name}</h3>
                  <p className="card-subtitle">{student.batchName}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setProgressChartStudent(student); setShowProgressChart(true); }}
                  style={{
                    background: '#8B0000', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '6px 12px', fontSize: 12,
                    fontWeight: 600, cursor: 'pointer', flexShrink: 0
                  }}
                >
                  <TrendingUp size={14} style={{ marginRight: 5, verticalAlign: "middle" }} />Progress
                </button>
                <span style={{ color: '#c7c7cc', fontSize: 20 }}>›</span>
              </div>
            </div>
          </div>
          ))}
        </>
      );
    }

    // ── Company list view ─────────────────────────────────────────────
    return (
      <>
        <div className="sticky-header">
        <div className="header-banner">
          <div className="top-row">
            <div>
              <p className="logged-in-label">{t('loggedInAs')}</p>
              <h1 className="title kumiai-title">{kumiaiDisplayName}</h1>
            </div>
            <div className="top-row-actions">
              <span className="badge-view-only">{t('viewOnly')}</span>
              <button onClick={() => { safeLocalRemove(AUTH_KEY); safeLocalRemove(ROLE_KEY); safeLocalRemove(TOKEN_KEY); setIsLoggedIn(false); setIsViewer(false); setBatches([]); }} className="btn-logout">
                {t('logout')}
              </button>
            </div>
          </div>
        </div>
        </div>{/* end sticky-header */}

        <h2 className="section-title">
          {t('companies')} ({groupKeys.length})
        </h2>

        {groupKeys.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#8e8e93' }}>
            <div style={{ marginBottom: 10 }}><Users size={40} strokeWidth={1.2} /></div>
            <p>{t('noStudentsFound')}</p>
          </div>
        )}

        {groupKeys.map(groupKey => {
          const students = groups[groupKey];
          return (
            <div key={groupKey} className="card clickable"
              onClick={() => setSelectedCompany({ name: groupKey, students })}>
              <div className="card-content">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: 'rgba(139,0,0,0.08)', flexShrink: 0 }}><Building2 size={26} color="#8B0000" /></span>
                  <div>
                    <h2 className="card-title">{groupKey}</h2>
                    <p className="card-subtitle">{students.length} {t('studentPlural')}</p>
                  </div>
                </div>
                <span style={{ color: '#c7c7cc', fontSize: 20 }}>›</span>
              </div>
            </div>
          );
        })}
      </>
    );
  };


  const renderBatches = () => {
    // ── Global search logic ───────────────────────────────────────────────
    const query = globalSearch.trim().toLowerCase();
    const searchResults = query.length >= 1 ? (() => {
      const results = [];
      batches.forEach(batch => {
        batch.students
          .filter(s => !s.isArchived)
          .filter(s => isViewer ? s.status === 'Selected' : true)
          .forEach(s => {
            const nameMatch   = s.name?.toLowerCase().includes(query);
            const compMatch   = s.companyName?.toLowerCase().includes(query);
            const kumiaiMatch = s.kumiai?.toLowerCase().includes(query);
            const batchMatch  = batch.name?.toLowerCase().includes(query);
            if (nameMatch || compMatch || kumiaiMatch || batchMatch) {
              results.push({ student: s, batch });
            }
          });
      });
      return results.slice().sort((a, b) => a.student.name.localeCompare(b.student.name));
    })() : null;

    return (
    <>
      <div className="sticky-header">
      <div className="header-banner">
        <div className="bh-greeting-row">
          <div>
            <p className="bh-greeting-title">
              {isKazumi
                ? `Hello, ${selectedTeacher?.name || 'Ogawa Sensei'}`
                : isViewer
                ? (safeLocalGet(ROLE_KEY) === 'setouchi' ? 'SETOUCHI TECH COOPERATIVE'
                  : safeLocalGet(ROLE_KEY) === 'wbc' ? 'WORLD BUSINESS COOPERATIVE'
                  : safeLocalGet(ROLE_KEY) === 'gyoumusuishin' ? 'GYOUMU SUISHIN COOPERATIVE'
                  : safeLocalGet(ROLE_KEY) === 'greenservices' ? 'GREEN SERVICES'
                  : safeLocalGet(ROLE_KEY) === 'sulop' ? 'SULOP'
                  : 'PHGIC')
                : `Hello, ${selectedTeacher?.name || ''}`}
            </p>
            <p className="bh-greeting-sub">
              {isViewer ? t('viewOnly') : isKazumi ? 'View Only' : 'Welcome back to SAGE Bulacan'}
            </p>
          </div>

          <span className="avatar-wrap" style={{ flexShrink: 0 }}>
            {selectedTeacher?.photo
              ? <img src={selectedTeacher.photo} alt={selectedTeacher.name} />
              : <span style={{ fontSize: 22 }}>{selectedTeacher?.emoji || '👩‍🏫'}</span>
            }
          </span>
        </div>

        {/* ── Search bar + menu ── */}
        <div className="bh-search-row">
          <div className="bh-search-wrap">
            <Search size={16} className="bh-search-icon" />
            <input
              type="text"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Search students, company, batch..."
              className="bh-search-input"
            />
            {globalSearch && (
              <button onClick={() => setGlobalSearch('')} className="bh-search-clear"><X size={14} /></button>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              className="bh-sort-btn"
              title="Menu"
              onClick={() => setHeaderMenuOpen(o => !o)}
            >
              <MoreVertical size={18} />
            </button>
            {headerMenuOpen && (
              <>
                <div className="tc-menu-backdrop" onClick={() => setHeaderMenuOpen(false)} />
                <div className="tc-menu-dropdown" style={{ right: 0 }}>
                  {((!isViewer && !isKazumi) || isKazumi) && (
                    <button className="tc-menu-item" onClick={() => { safeLocalRemove(TEACHER_KEY); setSelectedTeacher(null); setBatches([]); }}>
                      <ArrowRightLeft size={14} /> Switch teacher
                    </button>
                  )}
                  <button className="tc-menu-item" onClick={() => { setDarkMode(d => !d); setHeaderMenuOpen(false); }}>
                    {darkMode ? <Sun size={14} /> : <Moon size={14} />} {darkMode ? 'Light mode' : 'Dark mode'}
                  </button>
                  {(safeLocalGet(ROLE_KEY) === 'admin' || isKazumi) && (
                    <button className="tc-menu-item" onClick={() => { setShowSettings(true); setHeaderMenuOpen(false); }}>
                      <Settings size={14} /> Settings
                    </button>
                  )}
                  <button className="tc-menu-item tc-menu-item--danger" onClick={() => { safeLocalRemove(AUTH_KEY); safeLocalRemove(ROLE_KEY); safeLocalRemove(TOKEN_KEY); safeLocalRemove(TEACHER_KEY); setIsLoggedIn(false); setIsViewer(false); setSelectedTeacher(null); setBatches([]); }}>
                    <X size={14} /> {t('logout')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

      </div>{/* end header-banner */}
      </div>{/* end sticky-header */}

      {/* ── Smart Reminders (teacher/admin only) ── */}
      {!isViewer && !isKazumi && (
        <SmartReminders
          batches={batches}
          onNavigate={(batch, student) => {
            setGlobalSearch('');
            setSelectedBatch(batch);
            goToCategories(student);
          }}
        />
      )}

      {/* ── Search results ── */}
      {searchResults !== null ? (
        <>
          <h2 className="section-title">
            {searchResults.length === 0
              ? 'No students found'
              : `${searchResults.length} student${searchResults.length !== 1 ? 's' : ''} found`}
          </h2>
          {searchResults.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
              <div style={{ marginBottom: 12 }}><Search size={44} strokeWidth={1.2} /></div>
              <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>No results for "{globalSearch}"</p>
              <p style={{ fontSize: 13, marginTop: 6, color: 'var(--text-tertiary)' }}>Try searching by name, company, or batch</p>
            </div>
          ) : (
            searchResults.map(({ student, batch }) => {
              // Highlight matching text
              const highlight = (text) => {
                if (!text || !query) return text;
                const idx = text.toLowerCase().indexOf(query);
                if (idx === -1) return text;
                return (
                  <>
                    {text.slice(0, idx)}
                    <mark style={{ background: '#fff3cd', color: '#856404', borderRadius: 3, padding: '0 2px' }}>
                      {text.slice(idx, idx + query.length)}
                    </mark>
                    {text.slice(idx + query.length)}
                  </>
                );
              };
              return (
                <div
                  key={`${batch._id}-${student._id}`}
                  className="bh-student-row"
                  onClick={() => {
                    setGlobalSearch('');
                    setSelectedBatch(batch);
                    goToCategories(student);
                  }}
                >
                  <div className="bh-student-avatar">
                    {student.photo
                      ? <img src={student.photo} alt={student.name} />
                      : <span className="student-avatar-icon"><User size={22} /></span>
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 className="card-title" style={{ margin: 0 }}>
                      {highlight(student.name)}
                    </h3>
                    <p className="card-subtitle" style={{ margin: '2px 0 0' }}>
                      <BookOpen size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{highlight(batch.name)}
                    </p>
                    {student.companyName && (
                      <p className="card-subtitle" style={{ margin: '2px 0 0' }}>
                        <Building2 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{highlight(student.companyName)}
                      </p>
                    )}
                    {student.kumiai && (
                      <span style={{
                        display: 'inline-block', marginTop: 4,
                        background: '#fff3cd', color: '#856404',
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      }}>
                        {highlight(student.kumiai)}
                      </span>
                    )}
                  </div>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 18, flexShrink: 0 }}>›</span>
                </div>
              );
            })
          )}
        </>
      ) : (
        <>
          {/* ── Normal batch list ── */}
          <h2 className="section-title">{isViewer ? t('allBatches') : t('myBatches')}</h2>

          {!isViewer && !isKazumi && (
            <div className="bh-chip-row">
              {[
                { key: 'all', label: 'All' },
                { key: 'visible', label: 'Visible' },
                { key: 'hidden', label: 'Hidden' },
              ].map(chip => (
                <button
                  key={chip.key}
                  className={`bh-chip${batchFilterTab === chip.key ? ' bh-chip--active' : ''}`}
                  onClick={() => setBatchFilterTab(chip.key)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {(() => {
            const baseBatches = isViewer
              ? batches.filter(b => !b.isHiddenFromViewer && (safeLocalGet(ROLE_KEY) === 'sulop'
                  ? b.students.some(s => !s.isArchived && s.scholarship === 'yes' && s.scholarshipType === 'Sulop')
                  : b.students.some(s => s.status === 'Selected')))
              : batches;
            const filtered = (!isViewer && !isKazumi)
              ? baseBatches.filter(b => batchFilterTab === 'all' ? true : batchFilterTab === 'visible' ? !b.isHiddenFromViewer : b.isHiddenFromViewer)
              : baseBatches;
            const sorted = filtered.slice().sort((a, b) => {
              if (batchSort === 'count') {
                return b.students.filter(s => !s.isArchived).length - a.students.filter(s => !s.isArchived).length;
              }
              return displayName(a).localeCompare(displayName(b));
            });

            if (sorted.length === 0) {
              return (
                <div className="tc-empty-mini" style={{ padding: '30px 16px' }}>
                  No batches in this filter yet.
                </div>
              );
            }

            return (
              <div className="bh-carousel">
                {sorted.map((batch, idx) => {
                  const studentCount = isViewer
                    ? batch.students.filter(s => !s.isArchived && s.status === 'Selected').length
                    : batch.students.filter(s => !s.isArchived).length;
                  const theme = BATCH_THEMES[idx % BATCH_THEMES.length];
                  return (
                    <div key={batch._id} className="bh-hero-card bh-carousel-item">
                      <div className="bh-hero-top">
                        <BatchThemeArt theme={theme} />
                        {!isViewer && !isKazumi && (
                          <button
                            className="bh-hero-badge bh-hero-badge--left"
                            title="Delete batch"
                            onClick={(e) => deleteBatch(batch._id, e)}
                          >
                            <X size={14} />
                          </button>
                        )}
                        {!isViewer && !isKazumi && (
                          <button
                            className={`bh-hero-badge bh-hero-badge--right${batch.isHiddenFromViewer ? ' bh-hero-badge--hidden' : ''}`}
                            title={batch.isHiddenFromViewer ? 'Show to PHGIC/Viewers' : 'Hide from PHGIC/Viewers'}
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(`${API}/batches/${batch._id}/toggle-hide`, { method: 'PATCH' });
                                const data = await res.json();
                                if (data.success) {
                                  setBatches(prev => prev.map(b =>
                                    b._id === batch._id ? { ...b, isHiddenFromViewer: data.isHiddenFromViewer } : b
                                  ));
                                } else {
                                  alert('Toggle failed: ' + (data.error || JSON.stringify(data)));
                                }
                              } catch(err) {
                                alert('Toggle error: ' + err.message);
                              }
                            }}
                          >
                            {batch.isHiddenFromViewer ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        )}
                        <div className="bh-hero-info">
                          <p className="bh-hero-name">{displayName(batch)}</p>
                          <p className="bh-hero-sub">{studentCount} student{studentCount !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <button className="bh-hero-footer" onClick={() => goToStudents(batch)}>
                        <span className="bh-hero-footer-label">See students</span>
                        <span className="bh-hero-arrow"><ChevronRight size={17} /></span>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div className="bh-bottom-spacer" />
          <div className="bh-bottom-bar">
            {!isViewer && !isKazumi && (
              <button className="bh-bottom-btn" onClick={() => openModal('batch')}>
                <Plus size={17} /> {t('addNewBatch')}
              </button>
            )}
            <button className="bh-bottom-btn bh-bottom-btn--accent" onClick={() => setShowQRScanner(true)}>
              <Camera size={17} /> Scan QR
            </button>
          </div>
        </>
      )}
    </>
    );
  };

  const renderStudents = () => {
    const role = safeLocalGet(ROLE_KEY);
    let visibleStudents = selectedBatch.students;
    if (role === 'setouchi') visibleStudents = visibleStudents.filter(s => !s.isArchived && s.status === 'Selected' && (s.kumiai === 'Setouchi' || (!s.kumiai && s.companyName === 'Setouchi')));
    else if (role === 'wbc') visibleStudents = visibleStudents.filter(s => !s.isArchived && s.status === 'Selected' && (s.kumiai === 'WBC' || (!s.kumiai && s.companyName === 'WBC')));
    else if (role === 'gyoumusuishin') visibleStudents = visibleStudents.filter(s => !s.isArchived && s.status === 'Selected' && s.kumiai === 'Gyoumusuishin');
    else if (role === 'greenservices') visibleStudents = visibleStudents.filter(s => !s.isArchived && s.status === 'Selected' && s.kumiai === 'Green Services');
    else if (role === 'sulop') visibleStudents = visibleStudents.filter(s => !s.isArchived && s.scholarship === 'yes' && s.scholarshipType === 'Sulop');
    else if (isViewer) visibleStudents = visibleStudents.filter(s => !s.isArchived && s.status === 'Selected');
    visibleStudents = visibleStudents.slice().sort((a, b) => a.name.localeCompare(b.name));
    return (
    <>
      <div className="sticky-header sticky-header--back">
        <button className="back-btn" onClick={goBack}><ArrowLeft size={18} /></button>
        <div className="header-with-back">
          <h1 className="title">{displayName(selectedBatch)}</h1>
        </div>
      </div>
      <h2 className="section-title">{t('students')}</h2>
      {visibleStudents.map(student => (
        <div key={student._id} className="card student-card clickable" onClick={() => goToCategories(student)}>
          <div className="card-content">
            <div className="student-card-left">
              {student.photo
                ? <img src={student.photo} alt={student.name} className="student-avatar"
                    onClick={(e) => { e.stopPropagation(); setImageViewer({ images: [student.photo], index: 0 }); }}
                    style={{ cursor: 'pointer' }} />
                : <span className="student-avatar-icon"><User size={22} /></span>
              }
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h3 className="card-title" style={{ margin: 0 }}>{student.name}</h3>
                  <span
                    onClick={!isViewer && !isKazumi ? (e) => toggleStudentStatus(student, e) : undefined}
                    style={{
                      background: student.status === 'Selected' ? '#007AFF' : '#e5e5ea',
                      color: student.status === 'Selected' ? '#fff' : '#6e6e73',
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      cursor: isViewer ? 'default' : 'pointer'
                    }}>
                    {student.status === 'Selected' ? t('statusSelected') : t('statusRegular')}
                  </span>
                  {student.status === 'Selected' && student.kumiai && (
                    <span style={{
                      background: '#fff3cd', color: '#856404',
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    }}>
                      {student.kumiai}
                    </span>
                  )}
                  {student.status === 'Selected' && student.companyName && (
                    <span style={{
                      background: '#e8f5e9', color: '#2e7d32',
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    }}>
                      {student.companyName}
                    </span>
                  )}
                </div>
                <p className="card-subtitle">{student.categories?.length || 0} categor{student.categories?.length !== 1 ? "ies" : "y"}</p>
              </div>
            </div>
            {!isViewer && !isKazumi && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="delete-btn-icon" style={{ background: '#e5f1ff', color: '#007AFF', border: 'none' }} onClick={(e) => openEditStudent(student, e)}><MoreHorizontal size={13} /></button>
                <button className="delete-btn-icon" onClick={(e) => deleteStudent(student._id, e)}><X size={14} /></button>
              </div>
            )}
          </div>
        </div>
      ))}
      {!isViewer && !isKazumi && <button className="add-button" onClick={() => openModal('student')}>{t('addStudent')}</button>}
      {selectedBatch.students.length > 0 && !isViewer && !isKazumi && (
        <button className="print-qr-button" onClick={generateBatchQRs}>{t('printQrCodes')}</button>
      )}
    </>
    );
  };

  const renderCategories = () => {
    /* ── compute progress stats for the mini card ── */
    const allExamsFlat = (selectedStudent.categories || []).flatMap(cat =>
      (cat.items || []).filter(it => it.score != null && it.totalScore).map(it => ({
        pct: Math.round((it.score / it.totalScore) * 100),
        date: it.date ? new Date(it.date) : null,
      }))
    ).sort((a, b) => (a.date || 0) - (b.date || 0));
    const n = allExamsFlat.length;
    const avg = n > 0 ? Math.round(allExamsFlat.reduce((s, e) => s + e.pct, 0) / n) : null;
    const win = Math.min(3, Math.floor(n / 2));
    const recentTrend = n >= 2
      ? Math.round(allExamsFlat.slice(-win).reduce((s, e) => s + e.pct, 0) / win) -
        Math.round(allExamsFlat.slice(-(win * 2), -win).reduce((s, e) => s + e.pct, 0) / win)
      : null;
    let streak = 0;
    for (let i = n - 1; i > 0; i--) { if (allExamsFlat[i].pct > allExamsFlat[i-1].pct) streak++; else break; }

    return (
    <>
      <div className="sticky-header sticky-header--back">
        <button className="back-btn" onClick={goBack}><ArrowLeft size={18} /></button>
        <div className="header-with-back" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {selectedStudent.photo
            ? <img src={selectedStudent.photo} alt={selectedStudent.name} className="sp-mini-avatar"
                onClick={() => setImageViewer({ images: [selectedStudent.photo], index: 0 })} />
            : <span className="sp-mini-avatar sp-mini-avatar--icon"><User size={16} /></span>
          }
          <h1 className="title">{selectedStudent.name}</h1>
        </div>
      </div>

      {/* ══════════════ TAB: PROFILE ══════════════ */}
      {profileTab === 'profile' && (
        <div className="sp-tab-card">
          <div className="sp-tab-card-header">
            <span className="sp-tab-card-icon"><User size={16} /></span>
            <span className="sp-tab-card-title">Quick Actions</span>
          </div>
          {/* ── Admin Quick Actions ── */}
          {!isViewer && !isKazumi ? (
            <>
              <div className="profile-icon-grid">
                <button className="profile-icon-btn" onClick={() => setShowQuickAddExam(true)}>
                  <span className="profile-icon-circle profile-icon-circle--green"><Plus size={18} /></span>
                  <span>Quick Add</span>
                </button>
                <button className="profile-icon-btn" onClick={() => { setParentQRStudent(selectedStudent); setShowParentQR(true); }}>
                  <span className="profile-icon-circle profile-icon-circle--purple"><KeyRound size={18} /></span>
                  <span>Parent QR</span>
                </button>
                <button className="profile-icon-btn" onClick={async () => {
                  if (!window.confirm(`Archive all exam images of ${selectedStudent.name}?`)) return;
                  try {
                    const res = await fetch(`${API}/archive/student/${selectedBatch._id}/${selectedStudent._id}`, { method: 'POST' });
                    const data = await res.json();
                    if (data.success) alert(`✅ Archived! ${data.migrated} image(s) moved, ${data.skipped} skipped.`);
                    else alert('Error: ' + (data.error || 'Unknown'));
                  } catch (e) { alert('Failed: ' + e.message); }
                }}>
                  <span className="profile-icon-circle profile-icon-circle--gray"><Layers size={18} /></span>
                  <span>Archive Imgs</span>
                </button>
                <button className="profile-icon-btn" onClick={async () => {
                  if (!window.confirm(`Restore all images of ${selectedStudent.name} back to main storage?`)) return;
                  try {
                    const res = await fetch(`${API}/archive/restore/${selectedBatch._id}/${selectedStudent._id}`, { method: 'POST' });
                    const data = await res.json();
                    if (data.success) alert(`✅ Restored! ${data.migrated} image(s) moved back, ${data.skipped} skipped.`);
                    else alert('Error: ' + (data.error || 'Unknown'));
                  } catch (e) { alert('Failed: ' + e.message); }
                }}>
                  <span className="profile-icon-circle profile-icon-circle--blue"><RefreshCw size={18} /></span>
                  <span>Restore Imgs</span>
                </button>
              </div>

              <p className="profile-action-label" style={{ marginTop: 14 }}>Student Status</p>
              <div className="profile-danger-row">
                <button
                  className="profile-danger-btn"
                  style={{ color: '#007AFF' }}
                  onClick={openMoveModal}
                >
                  <ArrowRightLeft size={15} />
                  Move to Batch
                </button>
                <button className="profile-danger-btn" onClick={() => toggleArchiveStudent(selectedStudent)}>
                  {selectedStudent.isArchived ? t('unarchiveStudent') : t('hideFromKumiai')}
                </button>
                <button className="profile-danger-btn profile-danger-btn--red" onClick={async () => {
                  if (!window.confirm(`⚠️ PERMANENT DELETE: This will delete ALL images and the student record of ${selectedStudent.name}. This cannot be undone!`)) return;
                  if (!window.confirm(`Are you sure? This is irreversible.`)) return;
                  try {
                    const res = await fetch(`${API}/archive/permanent/${selectedBatch._id}/${selectedStudent._id}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                      alert(`${selectedStudent.name} permanently deleted.`);
                      const deletedStudentId = selectedStudent._id;
                      const deletedBatchId = selectedBatch._id;
                      setBatches(prev => prev.map(b =>
                        b._id === deletedBatchId
                          ? { ...b, students: b.students.filter(s => s._id !== deletedStudentId) }
                          : b
                      ));
                      try {
                        const dismissed = JSON.parse(localStorage.getItem('sage_dismissed_reminders') || '[]');
                        const cleaned = dismissed.filter(id => !id.includes(deletedStudentId));
                        localStorage.setItem('sage_dismissed_reminders', JSON.stringify(cleaned));
                      } catch {}
                      goBack();
                    }
                    else alert('Error: ' + (data.error || 'Unknown'));
                  } catch (e) { alert('Failed: ' + e.message); }
                }}>
                  <Trash2 size={15} />
                  {t('deleteStudent')}
                </button>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0, textAlign: 'center', padding: '12px 0' }}>View-only access</p>
          )}
        </div>
      )}

      {/* ══════════════ TAB: PROGRESS ══════════════ */}
      {profileTab === 'progress' && (
        <div className="sp-tab-card" onClick={() => { setProgressChartStudent(selectedStudent); setShowProgressChart(true); }} style={{ cursor: 'pointer' }}>
          <div className="sp-tab-card-header">
            <span className="sp-tab-card-icon"><TrendingUp size={16} /></span>
            <span className="sp-tab-card-title">{t('progressChart')}</span>
            <span className="sp-tab-card-link">View full →</span>
          </div>
          {n === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0 }}>No exam data yet</p>
          ) : (
            <>
              <div className="progress-summary-stats">
                <div>
                  <p className="progress-stat-label">Avg score</p>
                  <p className="progress-stat-value">{avg}%</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {recentTrend !== null && (
                    <span className={`progress-trend-pill ${recentTrend >= 0 ? 'progress-trend-pill--up' : 'progress-trend-pill--down'}`}>
                      {recentTrend >= 0 ? '↑' : '↓'} {Math.abs(recentTrend)}% trend
                    </span>
                  )}
                  <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {n} exam{n !== 1 ? 's' : ''}{streak > 1 ? ` · 🔥 ${streak}-streak` : ''}
                  </p>
                </div>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${Math.min(avg, 100)}%` }} />
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════ TAB: EXAMS ══════════════ */}
      {profileTab === 'exams' && (
        <div className="sp-tab-card">
          <div className="sp-tab-card-header">
            <span className="sp-tab-card-icon"><Folder size={16} /></span>
            <span className="sp-tab-card-title">{t('examCategoriesTitle')}</span>
            {!isViewer && !isKazumi && (
              <button onClick={() => openModal('category')} className="sp-tab-card-add">+ Add</button>
            )}
          </div>
          {(selectedStudent.categories || []).length === 0
            ? <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0, textAlign: 'center', padding: '12px 0' }}>{t('noExamCategories')}</p>
            : (selectedStudent.categories || []).map(cat => (
              <div key={cat._id} className="card exam-card clickable" style={{ margin: '0 0 8px 0' }} onClick={() => goToExamItems(cat)}>
                <div className="card-content">
                  <div>
                    <h3 className="card-title"><Folder size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />{displayName(cat)}</h3>
                    <p className="card-subtitle">{cat.items?.length || 0} exam{cat.items?.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="exam-right">
                    {!isViewer && !isKazumi && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="delete-btn-icon" style={{ background: '#e5f1ff', color: '#007AFF', border: 'none' }}
                          onClick={(e) => { e.stopPropagation(); setEditingCategory(cat); setNewName(cat.name); setNewNameJa(cat.name_ja || ''); setModalType('editCategory'); setShowModal(true); }}><MoreHorizontal size={13} /></button>
                        <button className="delete-btn-icon" onClick={(e) => deleteCategory(cat._id, e)}><X size={14} /></button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* ══════════════ TAB: EVALUATIONS ══════════════ */}
      {profileTab === 'evaluations' && (
        <div className="sp-tab-card">
          <div className="sp-tab-card-header">
            <span className="sp-tab-card-icon"><FileText size={16} /></span>
            <span className="sp-tab-card-title">{t('evaluationsTitle')}</span>
            {!isViewer && !isKazumi && (
              <button onClick={() => { setEvalTitle(''); setEvalDate(new Date().toISOString().split('T')[0]); openModal('evaluation'); }} className="sp-tab-card-add" style={{ background: 'var(--green)', boxShadow: '0 3px 10px rgba(16,185,129,0.3)' }}>+ Add</button>
            )}
          </div>
          <button onClick={goToEvaluations} style={{ width: '100%', background: 'var(--surface2)', border: 'none', borderRadius: 10, padding: '10px 14px', textAlign: 'left', fontSize: 14, color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 500 }}>
            {t('viewAllEvaluations')}
          </button>
        </div>
      )}

      {/* ══════════════ BOTTOM DOCK ══════════════ */}
      <div className="sp-bottom-spacer" />
      <div className="sp-dock">
        <button className={`sp-dock-btn${profileTab === 'profile' ? ' sp-dock-btn--active' : ''}`} onClick={() => setProfileTab('profile')} title="Profile">
          <User size={19} />
        </button>
        <button className={`sp-dock-btn${profileTab === 'progress' ? ' sp-dock-btn--active' : ''}`} onClick={() => setProfileTab('progress')} title="Progress">
          <TrendingUp size={19} />
        </button>
        <button className={`sp-dock-btn${profileTab === 'exams' ? ' sp-dock-btn--active' : ''}`} onClick={() => setProfileTab('exams')} title="Exam Categories">
          <Folder size={19} />
        </button>
        <button className={`sp-dock-btn${profileTab === 'evaluations' ? ' sp-dock-btn--active' : ''}`} onClick={() => setProfileTab('evaluations')} title="Evaluations">
          <FileText size={19} />
        </button>
      </div>
    </>
    );
  };

  const renderEvaluations = () => (
    <>
      <div className="sticky-header sticky-header--back">
        <button className="back-btn" onClick={goBack}><ArrowLeft size={18} /></button>
      </div>
      <div className="student-profile-header">
        {selectedStudent.photo
          ? <img src={selectedStudent.photo} alt={selectedStudent.name} className="student-profile-avatar"
              onClick={() => setImageViewer({ images: [selectedStudent.photo], index: 0 })}
              style={{ cursor: 'pointer' }} />
          : <span className="student-profile-icon"><User size={22} /></span>
        }
        <h1 className="student-profile-name">{selectedStudent.name}</h1>
      </div>
      <h2 className="section-title">{t('evaluations')}</h2>
      {evaluations.length === 0
        ? <p style={{ fontSize: 14, color: '#8e8e93', textAlign: 'center', marginTop: 32 }}>{t('noEvaluationsYet')}</p>
        : evaluations.map(ev => (
          <div key={ev._id} className="card exam-card clickable" onClick={() => goToEvaluationDetail(ev)}>
            <div className="card-content">
              <div>
                <h3 className="card-title"><FileText size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />{ev.ordinal} Evaluation — {ev.title}</h3>
                <p className="card-subtitle">📅 {ev.date}</p>
              </div>
              {!isViewer && !isKazumi && <button className="delete-btn-icon" onClick={(e) => deleteEvaluation(ev._id, e)}><X size={14} /></button>}
            </div>
          </div>
        ))
      }
      {!isViewer && !isKazumi && (
        <button className="add-button" onClick={() => { setEvalTitle(''); setEvalDate(new Date().toISOString().split('T')[0]); openModal('evaluation'); }}>{t('addEvaluation')}</button>
      )}
    </>
  );

  const translateRemarks = (text) => {
    if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
    if (!text.trim()) { setRemarksTranslation(''); return; }
    translateTimerRef.current = setTimeout(async () => {
      setTranslating(true);
      try {
        const res = await fetch(`${API}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        console.log('[translate] response:', data);
        if (data.translation) {
          setRemarksTranslation(data.translation);
        } else {
          console.warn('[translate] empty translation, error:', data.error);
          setRemarksTranslation('');
        }
      } catch (err) {
        console.error('[translate] fetch error:', err);
        setRemarksTranslation('');
      }
      finally { setTranslating(false); }
    }, 900);
  };

  const renderEvaluationDetail = () => {
    const ratingField = (key, label, sublabel) => (
      <div style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#3a3a3c' }}>{label}</span>
          {sublabel && <span style={{ fontSize: 12, color: '#8e8e93', marginLeft: 6 }}>{sublabel}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
            {[...Array(11)].map((_, i) => (
              <button key={i} onClick={() => !isViewer && !isKazumi && setEvalFields(f => ({ ...f, [key]: i }))}
                style={{
                  width: 36, height: 36, borderRadius: 8, border: 'none', cursor: isViewer ? 'default' : 'pointer',
                  fontWeight: 700, fontSize: 13,
                  background: evalFields[key] === i ? '#007AFF' : '#f2f2f7',
                  color: evalFields[key] === i ? '#fff' : '#3a3a3c',
                  transition: 'all 0.15s'
                }}>
                {i}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#007AFF', minWidth: 32, textAlign: 'right' }}>
            {evalFields[key] ?? '—'}
          </span>
        </div>
      </div>
    );

    const textField = (key, label, sublabel, placeholder) => {
      const isRemarks = key === 'remarks';
      const value = evalFields[key] || '';
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#3a3a3c' }}>{label}</span>
            {sublabel && <span style={{ fontSize: 12, color: '#8e8e93', marginLeft: 6 }}>{sublabel}</span>}
          </div>
          {isRemarks ? (
            isViewer ? (
              <div style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box',
                background: '#f9f9f9', color: '#3a3a3c', fontFamily: 'inherit',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 44,
                lineHeight: 1.5,
              }}>
                {value || <span style={{ color: '#c7c7cc' }}>{placeholder}</span>}
              </div>
            ) : (
              <div>
                <textarea
                  value={value}
                  onChange={(e) => {
                    setEvalFields(f => ({ ...f, [key]: e.target.value }));
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                    translateRemarks(e.target.value);
                  }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  placeholder={placeholder}
                  lang="ja"
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box',
                    background: '#fff', color: '#3a3a3c', fontFamily: 'inherit',
                    resize: 'none', overflow: 'hidden', lineHeight: 1.5,
                    minHeight: 80,
                  }}
                />
                {/* Translation preview */}
                {(translating || remarksTranslation) && (
                  <div style={{
                    marginTop: 8, padding: '10px 12px', borderRadius: 10,
                    background: '#f0f7ff', border: '1.5px solid #cce4ff',
                    fontSize: 14, lineHeight: 1.6, color: '#1a1a2e',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#007AFF', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, letterSpacing: 0.5 }}>
                      <Flag size={11} /> 日本語訳 {translating && '…'}
                    </span>
                    {translating
                      ? <span style={{ color: '#8e8e93', fontStyle: 'italic' }}>Translating...</span>
                      : <span>{remarksTranslation}</span>
                    }
                    {!translating && remarksTranslation && (
                      <button
                        onClick={() => {
                          setEvalFields(f => ({ ...f, [key]: remarksTranslation }));
                          setRemarksTranslation('');
                        }}
                        style={{
                          display: 'block', marginTop: 8, background: '#007AFF',
                          color: '#fff', border: 'none', borderRadius: 8,
                          padding: '6px 14px', fontSize: 13, fontWeight: 700,
                          cursor: 'pointer',
                        }}>
                        <Check size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />Use Japanese
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => !isViewer && !isKazumi && setEvalFields(f => ({ ...f, [key]: e.target.value }))}
              readOnly={isViewer}
              placeholder={placeholder}
              lang="ja"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1.5px solid #e5e5ea', fontSize: 15, boxSizing: 'border-box',
                background: isViewer ? '#f9f9f9' : '#fff', color: '#3a3a3c',
                fontFamily: 'inherit'
              }}
            />
          )}
        </div>
      );
    };

    return (
      <>
        <div className="sticky-header sticky-header--back">
          <button className="back-btn" onClick={goBack}><ArrowLeft size={18} /></button>
        </div>

        {/* Hero banner */}
        <div className="eval-hero">
          <div className="eval-hero-top">
            <div>
              <p className="eval-ordinal">{selectedEvaluation?.ordinal} Evaluation</p>
              <h1 className="eval-title">{selectedEvaluation?.title}</h1>
              <p className="eval-date">📅 {selectedEvaluation?.date}</p>
            </div>
            <div className="eval-student-badge">
              {selectedStudent?.photo
                ? <img src={selectedStudent.photo} alt={selectedStudent.name} className="eval-student-avatar" />
                : <span className="eval-student-icon"><User size={22} /></span>
              }
              <p className="eval-student-name">{selectedStudent?.name}</p>
            </div>
          </div>
          {selectedStudent?.companyName && (
            <div className="eval-company-chip">
              <Building2 size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />{selectedStudent.companyName}
            </div>
          )}
        </div>

        {/* Skills Rating */}
        <div className="section-box">
          <div className="section-box-header">
            <span className="section-box-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Target size={14} /> Skills Rating</span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Score 0 – 10</span>
          </div>
          {ratingField('reading',   'READING',   '読むこと')}
          {ratingField('listening', 'LISTENING', '聞くこと')}
          {ratingField('speaking',  'SPEAKING',  '話すこと')}
        </div>

        {/* Comparison vs Previous Evaluation */}
        {(() => {
          const currentIdx = evaluations.findIndex(ev => ev._id === selectedEvaluation?._id);
          if (currentIdx <= 0) return null; // no previous eval to compare
          const prevEval = evaluations[currentIdx - 1];
          const prevFields = prevEval?.fields || {};
          const skills = [
            { key: 'reading',   label: 'READING',   jp: '読むこと' },
            { key: 'listening', label: 'LISTENING', jp: '聞くこと' },
            { key: 'speaking',  label: 'SPEAKING',  jp: '話すこと' },
          ];
          const hasPrevData = skills.some(s => prevFields[s.key] != null);
          if (!hasPrevData) return null;
          return (
            <div className="section-box">
              <div className="section-box-header">
                <span className="section-box-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TrendingUp size={14} /> vs Previous Evaluation
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>
                  {prevEval.ordinal} Eval
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {skills.map(({ key, label, jp }) => {
                  const curr = evalFields[key];
                  const prev = prevFields[key];
                  const diff = (curr != null && prev != null) ? curr - prev : null;
                  const diffColor = diff > 0 ? '#34C759' : diff < 0 ? '#FF3B30' : '#8e8e93';
                  const DiffIcon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 5 }}>{jp}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120, justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                          {prev ?? '—'} → {curr ?? '—'}
                        </span>
                        {diff !== null && (
                          <span style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            background: diff > 0 ? '#e8f9ed' : diff < 0 ? '#fff0ef' : '#f2f2f7',
                            color: diffColor, borderRadius: 8,
                            padding: '3px 9px', fontSize: 12, fontWeight: 700,
                          }}>
                            <DiffIcon size={12} />
                            {diff > 0 ? `+${diff}` : diff === 0 ? '±0' : diff}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Lesson Details */}
        <div className="section-box">
          <div className="section-box-header">
            <span className="section-box-title">📖 Lesson Details</span>
          </div>
          <div className="eval-lesson-row">
            <div className="form-group" style={{ flex: 1 }}>
              {textField('from', 'FROM', null, 'e.g., Lesson 1')}
            </div>
            <div className="eval-lesson-arrow">→</div>
            <div className="form-group" style={{ flex: 1 }}>
              {textField('to', 'TO', null, 'e.g., Lesson 10')}
            </div>
          </div>
          {textField('currentLesson', 'CURRENT LESSON', null, 'e.g., Chapter 3 - Greetings')}
        </div>

        {/* Remarks */}
        <div className="section-box">
          <div className="section-box-header">
            <span className="section-box-title">💬 Remarks</span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>備考</span>
          </div>
          {!isViewer && !isKazumi && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                Quick Templates
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { en: 'Excellent progress', jp: '非常に上手です' },
                  { en: 'Good effort', jp: 'よく頑張りました' },
                  { en: 'Needs more practice', jp: 'もっと練習が必要です' },
                  { en: 'Great attitude', jp: '積極的な姿勢が良いです' },
                  { en: 'Improving steadily', jp: '着実に上達しています' },
                  { en: 'Needs to review vocabulary', jp: '語彙の復習が必要です' },
                ].map(({ en, jp }) => (
                  <button
                    key={en}
                    onClick={() => {
                      const current = evalFields.remarks || '';
                      const append = current ? `${current}\n${jp}` : jp;
                      setEvalFields(f => ({ ...f, remarks: append }));
                      translateRemarks(append);
                    }}
                    style={{
                      background: 'var(--bg-card2, #f2f2f7)',
                      border: '1px solid var(--border-color, #e5e5ea)',
                      borderRadius: 20, padding: '5px 12px',
                      fontSize: 12, fontWeight: 500,
                      color: 'var(--text-primary, #3a3a3c)',
                      cursor: 'pointer', lineHeight: 1.4,
                      transition: 'background 0.15s',
                    }}
                    title={jp}
                  >
                    {en}
                  </button>
                ))}
              </div>
            </div>
          )}
          {textField('remarks', null, null, 'コメントを入力してください...')}
        </div>

        {/* Teacher Signature */}
        {(() => {
          const batchTeacherId = selectedBatch?.teacherId;
          const teacher = allTeachers.find(t => t._id === batchTeacherId);
          if (!teacher?.signature) return null;
          return (
            <div className="section-box">
              <div className="section-box-header">
                <span className="section-box-title">✍️ Teacher's Signature</span>
              </div>
              <div className="eval-signature-row">
                <img
                  src={teacher.signature}
                  alt={`${teacher.name} signature`}
                  className="eval-signature-img"
                />
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{teacher.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>Class Teacher</p>
                </div>
              </div>
            </div>
          );
        })()}

        {!isViewer && !isKazumi && (
          <button onClick={saveEvaluationFields} disabled={evalSaving} className="btn-primary" style={{ marginBottom: 24, opacity: evalSaving ? 0.7 : 1, cursor: evalSaving ? 'not-allowed' : 'pointer' }}>
            {evalSaving ? t('saving') : t('saveEvaluation')}
          </button>
        )}
      </>
    );
  };

  // ── Exam drag-and-drop reorder logic ─────────────────────────────────────
  const enterReorderMode = () => {
    setDragItems([...(selectedCategory?.items || [])]);
    setReorderMode(true);
  };
  const exitReorderMode = () => {
    setReorderMode(false);
    setDraggingIdx(null);
    setDragOverIdx(null);
    dragStartY.current = null;
  };
  const saveReorder = async () => {
    try {
      const orderedIds = dragItems.map(i => i._id);
      await fetch(`${API}/batches/${selectedBatch._id}/students/${selectedStudent._id}/categories/${selectedCategory._id}/items/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      const updatedCat = { ...selectedCategory, items: dragItems };
      const updatedStudent = {
        ...selectedStudent,
        categories: selectedStudent.categories.map(c => c._id === selectedCategory._id ? updatedCat : c),
      };
      setSelectedCategory(updatedCat);
      setSelectedStudent(updatedStudent);
      setSelectedBatch(prev => ({
        ...prev,
        students: prev.students.map(s => s._id === updatedStudent._id ? updatedStudent : s),
      }));
      setBatches(prev => prev.map(b => b._id === selectedBatch._id
        ? { ...b, students: b.students.map(s => s._id === updatedStudent._id ? updatedStudent : s) }
        : b
      ));
    } catch (err) { console.error('Reorder failed:', err); }
    exitReorderMode();
  };

  // Touch handlers for drag-and-drop
  const handleDragTouchStart = (e, idx) => {
    dragStartY.current = e.touches[0].clientY;
    setDraggingIdx(idx);
  };
  const handleDragTouchMove = (e) => {
    if (draggingIdx === null) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    // Find which item we're hovering over based on DOM positions
    let overIdx = draggingIdx;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) overIdx = i;
    });
    if (overIdx !== dragOverIdx) setDragOverIdx(overIdx);
    if (overIdx !== draggingIdx) {
      setDragItems(prev => {
        const next = [...prev];
        const [moved] = next.splice(draggingIdx, 1);
        next.splice(overIdx, 0, moved);
        return next;
      });
      setDraggingIdx(overIdx);
    }
  };
  const handleDragTouchEnd = () => {
    setDragOverIdx(null);
  };

  const renderExamItems = () => {
    const displayItems = reorderMode ? dragItems : (selectedCategory?.items || []);
    return (
    <>
      <div className="sticky-header sticky-header--back">
        <button className="back-btn" onClick={reorderMode ? exitReorderMode : goBack}>
          {reorderMode ? <X size={18} /> : <ArrowLeft size={18} />}
        </button>
        <div className="header-with-back">
          <h1 className="title"><Folder size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />{displayName(selectedCategory)}</h1>
        </div>
        {/* Reorder mode: show Done button in header */}
        {reorderMode && (
          <button
            onClick={saveReorder}
            style={{
              marginLeft: 'auto', marginRight: 8,
              background: '#8B0000', color: '#fff',
              border: 'none', borderRadius: 10, padding: '6px 16px',
              fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }}
          >Done</button>
        )}
      </div>

      {/* Reorder mode banner */}
      {reorderMode && (
        <div style={{
          background: 'linear-gradient(135deg, #8B0000, #c0392b)',
          color: '#fff', textAlign: 'center', padding: '10px 16px',
          fontSize: 14, fontWeight: 600, letterSpacing: 0.3,
        }}>
          ☰ Hold and drag to reorder exams
        </div>
      )}

      <h2 className="section-title">{t('exams')}</h2>
      {displayItems.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><FileText size={40} strokeWidth={1.2} /></div>
          <p className="empty-state-text">{t('noExamsYet')}</p>
          <p className="empty-state-sub">{t('addExamHint')}</p>
        </div>
      ) : (
        <div
          className="exam-list"
          onTouchMove={reorderMode ? handleDragTouchMove : undefined}
          onTouchEnd={reorderMode ? handleDragTouchEnd : undefined}
        >
          {displayItems.map((item, idx) => {
            const score = item.score ?? 0;
            const total = item.totalScore ?? 100;
            const pct = Math.round((score / total) * 100);
            const color = pct >= 60 ? 'var(--green)' : 'var(--red)';
            const bg   = pct >= 60 ? 'var(--green-soft)' : 'var(--red-soft)';
            const isDragging = reorderMode && draggingIdx === idx;
            const isOver = reorderMode && dragOverIdx === idx && draggingIdx !== idx;
            return (
              <div
                key={item._id}
                ref={el => itemRefs.current[idx] = el}
                className="exam-list-card clickable"
                onClick={reorderMode ? undefined : () => goToExamDetail(item)}
                onTouchStart={reorderMode ? (e) => handleDragTouchStart(e, idx) : undefined}
                style={{
                  transition: reorderMode ? 'transform 0.15s, box-shadow 0.15s, opacity 0.15s' : undefined,
                  opacity: isDragging ? 0.5 : 1,
                  transform: isOver ? 'scaleY(1.04)' : isDragging ? 'scale(1.03)' : 'none',
                  boxShadow: isDragging ? '0 8px 24px rgba(139,0,0,0.25)' : undefined,
                  borderLeft: isOver ? '3px solid #8B0000' : undefined,
                  cursor: reorderMode ? 'grab' : 'pointer',
                  userSelect: 'none',
                  touchAction: reorderMode ? 'none' : undefined,
                }}
                // Long press on normal mode to enter reorder
                onTouchStartCapture={!isViewer && !isKazumi && !reorderMode ? (() => {
                  const handler = () => {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = setTimeout(() => {
                      if (navigator.vibrate) navigator.vibrate(40);
                      enterReorderMode();
                    }, 500);
                  };
                  return handler;
                })() : undefined}
                onTouchEndCapture={!isViewer && !isKazumi && !reorderMode ? () => clearTimeout(longPressTimer.current) : undefined}
                onTouchMoveCapture={!isViewer && !isKazumi && !reorderMode ? () => clearTimeout(longPressTimer.current) : undefined}
              >
                {/* Drag handle — visible only in reorder mode */}
                {reorderMode && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, flexShrink: 0, color: '#8B0000', fontSize: 20, fontWeight: 700,
                    cursor: 'grab',
                  }}>☰</div>
                )}
                {/* Score badge */}
                <div className="exam-score-badge" style={{ background: bg, color }}>
                  <span className="exam-score-num">{score}</span>
                  <span className="exam-score-sep">/{total}</span>
                </div>
                {/* Info */}
                <div className="exam-list-info">
                  <p className="exam-list-name">{displayName(item)}</p>
                  <p className="exam-list-meta">{item.date}</p>
                  {item.images?.length > 0 && (
                    <span className="exam-photo-chip"><Camera size={12} style={{ marginRight: 3, verticalAlign: "middle" }} />{item.images.length} page{item.images.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
                {/* Pct pill + action buttons (hidden in reorder mode) */}
                {!reorderMode && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                    <span className="exam-pct-pill" style={{ background: bg, color }}>{pct}%</span>
                    {!isViewer && !isKazumi && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="delete-btn-icon" style={{ background: '#e5f1ff', color: '#007AFF', border: 'none' }}
                          onClick={(e) => { e.stopPropagation(); setEditingExam(item); setNewExamName(item.name); setNewNameJa(item.name_ja || ''); setNewScore(String(item.score ?? '')); setNewTotalScore(String(item.totalScore ?? 100)); setNewExamDate(item.date || ''); setModalType('editExam'); setShowModal(true); }}><MoreHorizontal size={13} /></button>
                        <button className="delete-btn-icon" onClick={(e) => deleteExamItem(item._id, e)}><X size={14} /></button>
                      </div>
                    )}
                  </div>
                )}
                {/* In reorder mode, just show % */}
                {reorderMode && (
                  <span className="exam-pct-pill" style={{ background: bg, color, flexShrink: 0 }}>{pct}%</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!isViewer && !isKazumi && !reorderMode && <button className="add-button" onClick={() => openModal('exam')}>{t('addExam')}</button>}
    </>
    );
  };

  const renderExamDetail = () => {
    const rawImages = selectedExam.images?.length > 0
      ? selectedExam.images
      : selectedExam.image ? [selectedExam.image] : [];
      const resolveOne = (idOrData) => {
        if (!idOrData || typeof idOrData !== 'string') return null;
  
        // Senior Fix: Force immediate return if it's a Cloudinary URL or Base64
        if (idOrData.startsWith('http') || idOrData.startsWith('data:')) {
          return idOrData;
        }
  
        // Fallback for legacy Object IDs
        return resolvedImages[idOrData] || imageCache.current?.[idOrData] || null;
      };
  
      // Filter(Boolean) ensures we don't map over nulls which cause the "Loading" box
      const allImages = (rawImages || []).map(resolveOne).filter(Boolean);
    const score = selectedExam.score ?? 0;
    const total = selectedExam.totalScore ?? 100;
    const pct = Math.round((score / total) * 100);
    const pctColor = pct >= 60 ? 'var(--green)' : 'var(--red)';
    const pctBg    = pct >= 60 ? 'var(--green-soft)' : 'var(--red-soft)';

    return (
      <>
        <div className="sticky-header sticky-header--back">
          <button className="back-btn" onClick={goBack}><ArrowLeft size={18} /></button>
        </div>

        {/* Hero score card */}
        <div className="exam-detail-hero">
          <div className="exam-detail-hero-left">
            <h1 className="exam-detail-title">{displayName(selectedExam)}</h1>
            <p className="exam-detail-date">📅 {selectedExam.date}</p>
          </div>
          <div className="exam-detail-score-ring" style={{ background: pctBg, borderColor: pctColor }}>
            <span className="exam-detail-score-num" style={{ color: pctColor }}>{score}</span>
            <span className="exam-detail-score-total" style={{ color: pctColor }}>/{total}</span>
            <span className="exam-detail-score-pct" style={{ color: pctColor }}>{pct}%</span>
          </div>
        </div>

        {/* Action buttons */}
        {!isViewer && !isKazumi && (
          <div className="exam-action-row">
            <button className="exam-action-btn scan" onClick={() => openScanner(selectedExam._id)}>
              <Camera size={16} style={{ marginRight: 6 }} />{t('scanPage')}
            </button>
            <button className="exam-action-btn upload" onClick={() => triggerFileInput(selectedExam._id)}>
              <Image size={16} style={{ marginRight: 6 }} />{t('upload')}
            </button>
          </div>
        )}

        {/* Pages */}
        <h2 className="section-title">
          {t('examPages')} {rawImages.length > 0 && `· ${rawImages.length} page${rawImages.length !== 1 ? 's' : ''}`}
        </h2>

        {rawImages.length === 0 ? (
          <div className="exam-empty-pages">
            <div style={{ marginBottom: 14 }}><File size={52} strokeWidth={1.2} color='#8e8e93' /></div>
            <p style={{ fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>{t('noPagesYet')}</p>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>{t('scanOrUpload')}</p>
          </div>
        ) : (
          <div className="exam-pages-grid">
            {rawImages.map((idOrData, idx) => {
              const src = resolveOne(idOrData);
              return (
                <div key={idx} className="exam-page-card">
                  {/* Page number pill */}
                  <div className="exam-page-num-pill">Page {idx + 1}</div>

                  {/* Delete button */}
                  {!isViewer && !isKazumi && (
                    <button
                      className="exam-page-delete"
                      onClick={(e) => { e.stopPropagation(); deleteImagePage(selectedExam._id, idx); }}
                    ><X size={14} /></button>
                  )}

                  {/* Image */}
                  {src ? (
                    <img
                      src={src}
                      alt={`Page ${idx + 1}`}
                      className="exam-page-img"
                      onClick={() => setImageViewer({ images: allImages.filter(Boolean), index: allImages.filter(Boolean).indexOf(src) })}
                    />
                  ) : (
                    <div className="exam-page-loading">
                      <Loader size={22} color="#8e8e93" style={{ animation: 'spin 1s linear infinite' }} />
                      <p>{t('loading')}</p>
                    </div>
                  )}

                  {/* {t('tapToView')} hint */}
                  {src && (
                    <div className="exam-page-tap-hint">{t('tapToView')}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ height: 16 }} />

        {!isViewer && !isKazumi && (
          <button className="btn-danger" style={{ width: '100%', marginTop: 8 }}
            onClick={(e) => deleteExam(selectedExam._id, e)}>
            {t('deleteExam')}
          </button>
        )}

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          multiple
          onChange={handleFileChange}
        />
      </>
    );
  };

  const renderModal = () => {
    if (!showModal) return null;
    const titles = { batch: t('addNewBatchModal'), student: t('addNewStudentModal'), editStudent: t('editStudentModal'), category: t('addExamCategory'), editCategory: t('editCategoryModal'), exam: t('addNewExam'), editExam: t('editExamModal'), evaluation: t('newEvaluation') };
    return (
      <div className="modal-overlay">
        <div className="modal-sheet">
          <div className="modal-handle" />
          <h2 className="modal-title">{titles[modalType]}</h2>
          {modalType === 'evaluation' ? (
            <>
              <div className="form-group">
                <label>{t('evaluationTitle')}</label>
                <input type="text" value={evalTitle} onChange={(e) => setEvalTitle(e.target.value)} placeholder="e.g., Mid-term, Final, Progress Check" />
              </div>
              <div className="form-group">
                <label>{t('date')}</label>
                <input type="date" value={evalDate} onChange={(e) => setEvalDate(e.target.value)} />
              </div>
              <p style={{ fontSize: 12, color: '#8e8e93', margin: '4px 0 0' }}>
                This will be saved as the <strong>{['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th'][evaluations.length] || `${evaluations.length+1}th`} Evaluation</strong>.
              </p>
            </>
          ) : modalType === 'category' || modalType === 'editCategory' ? (
            <div className="form-group">
              <label>{t('categoryName')}</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('categoryPlaceholder')} />
              <label style={{ marginTop: 10, display: 'block' }}><Flag size={11} style={{ marginRight: 5, verticalAlign: "middle" }} />日本語名（任意）</label>
              <input type="text" value={newNameJa} onChange={(e) => setNewNameJa(e.target.value)} placeholder="例：漢字、文法、語彙" />
            </div>
          ) : modalType === 'exam' || modalType === 'editExam' ? (
            <>
              <div className="form-group">
                <label>{t('examName')}</label>
                <input type="text" value={newExamName} onChange={(e) => setNewExamName(e.target.value)} placeholder={t('examNamePlaceholder')} />
                <label style={{ marginTop: 10, display: 'block' }}><Flag size={11} style={{ marginRight: 5, verticalAlign: "middle" }} />日本語名（任意）</label>
                <input type="text" value={newNameJa} onChange={(e) => setNewNameJa(e.target.value)} placeholder="例：小テスト１、中間試験、期末試験" />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>{t('score')}</label>
                  <input type="number" value={newScore} onChange={(e) => setNewScore(e.target.value)} placeholder={t('scorePlaceholder')} min="0" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>{t('totalScore')}</label>
                  <input type="number" value={newTotalScore} onChange={(e) => setNewTotalScore(e.target.value)} placeholder={t('totalScorePlaceholder')} min="1" />
                </div>
              </div>
              <div className="form-group">
                <label>{t('date')}</label>
                <input type="date" value={newExamDate} onChange={(e) => setNewExamDate(e.target.value)} />
              </div>
            </>
          ) : modalType === 'student' || modalType === 'editStudent' ? (
            <>
              <div className="form-group">
                <label>{t('name')}</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('namePlaceholder')} />
              </div>
              <div className="form-group">
                <label>{t('status')}</label>
                <select value={newStudentStatus} onChange={(e) => setNewStudentStatus(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, background: '#fff' }}>
                  <option value="Regular">{t('statusRegularOption')}</option>
                  <option value="Selected">{t('statusSelectedOption')}</option>
                </select>
              </div>
              {newStudentStatus === 'Selected' && (
                <>
                  <div className="form-group">
                    <label>{t('kumiai')}</label>
                    <select value={newKumiai} onChange={(e) => { setNewKumiai(e.target.value); setNewCompanyName(''); }}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, background: '#fff' }}>
                      <option value="">— {t('selectKumiai')} —</option>
                      <option value="Setouchi">Setouchi</option>
                      <option value="WBC">WBC</option>
                      <option value="Gyoumusuishin">Gyoumusuishin</option>
                      <option value="Green Services">Green Services</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('companyName')}</label>
                    {newKumiai === 'Setouchi' ? (
                      <select value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, background: '#fff' }}>
                        <option value="">— Select Company —</option>
                        <option value="AISHIN KIKOU CO., LTD">AISHIN KIKOU CO., LTD</option>
                        <option value="ANAN SUEO">ANAN SUEO</option>
                        <option value="BIZAN FOODS CO., LTD">BIZAN FOODS CO., LTD</option>
                        <option value="CORPORATION FURUSAWA FARM">CORPORATION FURUSAWA FARM</option>
                        <option value="CORPORATION KUBOTA FARM">CORPORATION KUBOTA FARM</option>
                        <option value="D CRAFT CO., LTD">D CRAFT CO., LTD</option>
                        <option value="ENDO MANUFACTURING CO., LTD">ENDO MANUFACTURING CO., LTD</option>
                        <option value="ES SEAL CO., LTD">ES SEAL CO., LTD</option>
                        <option value="ETOU HIDEKI">ETOU HIDEKI</option>
                        <option value="FURUSAWA CORPORATION">FURUSAWA CORPORATION</option>
                        <option value="HAGIWARA HIGHLAND FARM AGRICULTURAL ASSOCIATION CORPORATION">HAGIWARA HIGHLAND FARM AGRICULTURAL ASSOCIATION CORPORATION</option>
                        <option value="HASEGAWA CORPORATION">HASEGAWA CORPORATION</option>
                        <option value="JOIN(GOUDOU) COMPANY KUROKI FARM">JOIN (GOUDOU) COMPANY KUROKI FARM</option>
                        <option value="KUBOTA TAKESHI">KUBOTA TAKESHI</option>
                        <option value="KUDOU SEIICHI">KUDOU SEIICHI</option>
                        <option value="L AUTO CO., LTD">L AUTO CO., LTD</option>
                        <option value="LWC CORPORATION">LWC CORPORATION</option>
                        <option value="M FARM CO., LTD">M FARM CO., LTD</option>
                        <option value="MIYABI CORPORATION">MIYABI CORPORATION</option>
                        <option value="MT SHOJI CO., LTD ">MT SHOJI CO., LTD </option>
                        <option value="NAKAGAWA MANUFACTURING CO., LTD">NAKAGAWA MANUFACTURING CO., LTD</option>
                        <option value="NARIMATSU MASANAO">NARIMATSU MASANAO</option>
                        <option value="NISHIMURA HIRONORI">NISHIMURA HIRONORI</option>
                        <option value="NOUJI COOPERATIVE ASSOCIATION YOSHIURA RANCH">NOUJI COOPERATIVE ASSOCIATION YOSHIURA RANCH</option>
                        <option value="OKAMURA TSUYOSHI">OKAMURA TSUYOSHI</option>
                        <option value="OKAZAKI CO., LTD">OKAZAKI CO., LTD</option>
                        <option value="OROCHI CO., LTD ">OROCHI CO., LTD </option>
                        <option value="SANKO LIMITED COMPANY">SANKO LIMITED COMPANY</option>
                        <option value="SAWADA HIDEO">SAWADA HIDEO</option>
                        <option value="SEKITO INDUSTRY CO., LTD">SEKITO INDUSTRY CO., LTD</option>
                        <option value="SHINSEIKOUGYOU CO., LTD">SHINSEIKOUGYOU CO., LTD</option>
                        <option value="SHIRAHAMA SHINICHI">SHIRAHAMA SHINICHI</option>
                        <option value="SHOKI CO., LTD">SHOKI CO., LTD</option>
                        <option value="SHOUIE KOUGYOU CO., LTD">SHOUIE KOUGYOU CO., LTD</option>
                        <option value="SUNRISE CORPORATION">SUNRISE CORPORATION</option>
                        <option value="TAKAYAMA WELDER CO., LTD">TAKAYAMA WELDER CO., LTD</option>
                        <option value="TAKEDA CO., LTD">TAKEDA CO., LTD</option>
                        <option value="TSUCHIDA HIROYUKI">TSUCHIDA HIROYUKI</option>
                        <option value="UCHIMURAGUMI CO., LTD">UCHIMURAGUMI CO., LTD</option>
                        <option value="UEDA KOUJI">UEDA KOUJI</option>
                        <option value="WEST HILL CO., LTD">WEST HILL CO., LTD</option>
                        <option value="YABETEKKIN KOUGYOU CORPORATION">YABETEKKIN KOUGYOU CORPORATION</option>
                        <option value="YAMADA KENJI">YAMADA KENJI</option>
                        <option value="YASUDA PAINT CO., LTD">YASUDA PAINT CO., LTD</option>
                      </select>
                    ) : newKumiai === 'Gyoumusuishin' ? (
                      <select value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, background: '#fff' }}>
                        <option value="">— Select Company —</option>
                        <option value="KAGOSHIMA KIMOTSUKI AGRICULTURAL COOPERATIVE">KAGOSHIMA KIMOTSUKI AGRICULTURAL COOPERATIVE</option>
                        <option value="NAITO SATOSHI">NAITO SATOSHI</option>
                        <option value="CO., LTD KAMIKUBO LIVESTOCK">CO., LTD KAMIKUBO LIVESTOCK</option>
                        <option value="CO., LTD KIMURA DAIRY FARM">CO., LTDKIMURA DAIRY FARM</option>
                        <option value="KIRA FOOD CO., LTD">KIRA FOOD CO., LTD</option>
                        <option value="MARUYAMA FARM CO., LTD">MARUYAMA FARM CO., LTD</option>
                        <option value="YAMASHITA HIDENNOBU">YAMASHITA HIDENNOBU</option>
                        <option value="AGRICULTURAL UNION CORPORATION KAMOTO POULTRY FARMING ASSOCIATION">AGRICULTURAL UNION CORPORATION KAMOTO POULTRY FARMING ASSOCIATION</option>
                        <option value="CO., LTD SASSA RANCH">CO., LTD SASSA RANCH</option>
                        <option value="CO., LTD PAC">CO., LTD PAC</option>
                      </select>
                    ) : newKumiai === 'WBC' ? (
                      <select value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, background: '#fff' }}>
                        <option value="">— Select Company —</option>
                        <option value="KANAI METAL INDUSTRY CO., LTD">KANAI METAL INDUSTRY CO., LTD</option>
                        <option value="KAJIHARA KIKO CO., LTD">KAJIHARA KIKO CO., LTD</option>
                        <option value="HAYASHI SHOTEN CO., LTD">HAYASHI SHOTEN CO., LTD</option>
                        <option value="NAKAMOTOKIKOU CO., LTD">NAKAMOTO KIKOU CO., LTD</option>
                        <option value="MISAKIKANKOU CO., LTD">MISAKIKANKOU CO., LTD</option>
                        <option value="KAMEI INDUSTRY CO., LTD">KAMEI INDUSTRY CO., LTD</option>

                      </select>
                    ) : (
                      <input type="text" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)}
                        placeholder={t('companyPlaceholder')} />
                    )}
                  </div>
                </>
              )}
              <div className="form-group">
                <label>🎓 Scholarship</label>
                <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                  {['yes', 'no'].map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 15, fontWeight: newScholarship === opt ? 700 : 400, color: newScholarship === opt ? '#8B0000' : '#3a3a3c' }}>
                      <input
                        type="radio"
                        name="scholarship"
                        value={opt}
                        checked={newScholarship === opt}
                        onChange={() => { setNewScholarship(opt); setNewScholarshipType(''); }}
                        style={{ accentColor: '#8B0000', width: 18, height: 18 }}
                      />
                      {opt === 'yes' ? 'Yes' : 'No'}
                    </label>
                  ))}
                </div>
                {newScholarship === 'yes' && (
                  <select
                    value={newScholarshipType}
                    onChange={(e) => setNewScholarshipType(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #8B0000', fontSize: 15, background: '#fff', marginTop: 10 }}
                  >
                    <option value="">— Select Scholarship —</option>
                    <option value="Sulop">Sulop</option>
                  </select>
                )}
              </div>
              <div className="form-group">
                <label>{t('photoOptional')}</label>
                <div className="student-photo-upload" onClick={() => studentPhotoInputRef.current.click()}>
                  {newStudentPhoto
                    ? <img src={newStudentPhoto} alt="Preview" className="student-photo-preview" />
                    : <><span className="upload-icon" style={{ fontSize: 28 }}><User size={22} /></span><p style={{ margin: 0, fontSize: 13, color: '#8E8E93' }}>{t('tapToUploadPhoto')}</p></>
                  }
                </div>
                <input
                  type="file"
                  ref={studentPhotoInputRef}
                  style={{ display: 'none' }}
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const compressed = await compressImage(file, 400, 0.7);
                    setNewStudentPhoto(compressed);
                    e.target.value = '';
                  }}
                />
              </div>
            </>
          ) : (
            <div className="form-group">
              <label>{t('name')}</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('batchNamePlaceholder')} />
              <label style={{ marginTop: 10, display: 'block' }}><Flag size={11} style={{ marginRight: 5, verticalAlign: "middle" }} />日本語名（任意）</label>
              <input type="text" value={newNameJa} onChange={(e) => setNewNameJa(e.target.value)} placeholder="例：N5 土曜日 14:00" />
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn-secondary" onClick={closeModal} disabled={saving} style={{ flex: 1 }}>{t('cancel')}</button>
            <button className="btn-primary" disabled={saving} style={{ flex: 2 }}
              onClick={modalType === 'evaluation' ? createEvaluation : modalType === 'batch' ? saveBatch : modalType === 'editStudent' ? updateStudent : modalType === 'student' ? saveStudent : modalType === 'editCategory' ? updateCategory : modalType === 'editExam' ? updateExamItem : modalType === 'category' ? saveCategory : saveExamItem}>
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── MOVE STUDENT TO ANOTHER BATCH — modal ──
  const renderMoveModal = () => {
    if (!showMoveModal || !selectedStudent || !selectedBatch) return null;
    // GLOBAL: every batch across all teachers, minus the one the student is currently in
    const sourceList = allBatchesForMove.length ? allBatchesForMove : batches;
    const destinations = sourceList.filter(b => b._id !== selectedBatch._id);
    return (
      <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !moving) setShowMoveModal(false); }}>
        <div className="modal-sheet">
          <div className="modal-handle" />
          <h2 className="modal-title">Move Student to Another Batch</h2>
          <p style={{ fontSize: 13, color: '#8e8e93', margin: '0 0 14px' }}>
            <strong>{selectedStudent.name}</strong> will be moved out of <strong>{selectedBatch.name}</strong> together with all records — photo, categories, exams, scores, images, and evaluations. You can move to any batch, including other teachers' batches.
          </p>
          {loadingMoveBatches ? (
            <p style={{ fontSize: 14, color: '#8e8e93' }}>Loading batches…</p>
          ) : destinations.length === 0 ? (
            <p style={{ fontSize: 14, color: '#8e8e93' }}>No other batch is available. Create another batch first.</p>
          ) : (
            <div className="form-group">
              <label>Destination batch</label>
              <select
                value={moveTargetBatchId}
                onChange={(e) => setMoveTargetBatchId(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e5ea', fontSize: 15, background: '#fff' }}
              >
                <option value="">— Select a batch —</option>
                {destinations.map(b => {
                  const teacherName = b.teacherId ? moveTeacherMap[b.teacherId] : null;
                  return (
                    <option key={b._id} value={b._id}>
                      {b.name}{b.name_ja ? ` (${b.name_ja})` : ''}{teacherName ? ` — ${teacherName}` : ''} · {b.students?.length || 0} student(s)
                    </option>
                  );
                })}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn-secondary" onClick={() => setShowMoveModal(false)} disabled={moving} style={{ flex: 1 }}>{t('cancel')}</button>
            <button
              className="btn-primary"
              disabled={moving || loadingMoveBatches || !moveTargetBatchId || destinations.length === 0}
              style={{ flex: 2 }}
              onClick={moveStudent}
            >
              {moving ? 'Moving…' : 'Move Student'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handlePrint = (mode) => {
    // mode: 'portrait' = 6/page (2col x 3row), 'landscape' = 10/page (5col x 2row)
    const isLandscape = mode === 'landscape';
    const perPage = isLandscape ? 10 : 6;
    const cols = isLandscape ? 5 : 2;

    // Group cards into pages
    const pages = [];
    for (let i = 0; i < printQRs.length; i += perPage) {
      pages.push(printQRs.slice(i, i + perPage));
    }

    const cardSize   = isLandscape ? { avatar: '13mm', qr: '25mm', name: '6.5pt', batch: '5.5pt', pad: '3mm 2mm', gap: '3mm' }
                                   : { avatar: '18mm', qr: '34mm', name: '8pt',   batch: '7pt',   pad: '5mm 3mm', gap: '5mm' };

    const pagesHtml = pages.map((page, pi) => {
      const cards = page.map(item => `
        <div class="qr-card">
          ${item.photo
            ? `<img src="${item.photo}" class="avatar" />`
            : `<div class="avatar-placeholder"><svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/></svg></div>`}
          <img src="${item.dataUrl}" class="qr" />
          <p class="name">${item.name}</p>
          <p class="batch">${selectedBatch.name}</p>
        </div>
      `).join('');
      const isLast = pi === pages.length - 1;
      return `<div class="page${isLast ? '' : ' page-break'}">${cards}</div>`;
    }).join('');

    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Codes — ${selectedBatch.name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: sans-serif; background: #fff; }

          @page {
            size: A4 ${isLandscape ? 'landscape' : 'portrait'};
            margin: 10mm;
          }

          .page {
            display: grid;
            grid-template-columns: repeat(${cols}, 1fr);
            gap: ${cardSize.gap};
            width: 100%;
            /* Force exactly perPage cards — no overflow to next page */
          }
          .page-break {
            page-break-after: always;
            break-after: page;
          }

          .qr-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            padding: ${cardSize.pad};
            border: 0.4pt solid #bbb;
            border-radius: 3mm;
            background: #fff;
            overflow: hidden;
          }

          .avatar {
            width: ${cardSize.avatar};
            height: ${cardSize.avatar};
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
          }
          .avatar-placeholder {
            width: ${cardSize.avatar};
            height: ${cardSize.avatar};
            border-radius: 50%;
            background: #eee;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: calc(${cardSize.avatar} * 0.5);
            flex-shrink: 0;
          }
          .qr {
            width: ${cardSize.qr};
            height: ${cardSize.qr};
            flex-shrink: 0;
          }
          .name {
            font-size: ${cardSize.name};
            font-weight: 700;
            text-align: center;
            color: #111;
            word-break: break-word;
            line-height: 1.2;
          }
          .batch {
            font-size: ${cardSize.batch};
            color: #666;
            text-align: center;
          }

          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
          }

          /* Screen preview */
          @media screen {
            body { background: #e8e8e8; padding: 16px; padding-top: 70px; }
            .page { background: #fff; padding: 10mm; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
          }

          .top-bar {
            position: fixed; top: 0; left: 0; right: 0;
            background: #fff; padding: 12px 16px;
            display: flex; align-items: center; gap: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            z-index: 999;
          }
          .back-btn {
            background: #f2f2f7; border: none; border-radius: 8px;
            padding: 8px 16px; font-size: 15px; font-weight: 600;
            cursor: pointer; color: #1c1c1e;
          }
          .back-btn:hover { background: #e5e5ea; }
        </style>
      </head>
      <body>
        <div class="top-bar no-print">
          <button class="back-btn" onclick="window.close()">← Back</button>
          <span style="font-size:14px;color:#666;">QR Codes Preview — click Back or close this tab to return</span>
        </div>
        ${pagesHtml}
        <script>
          window.onload = function() { setTimeout(function() { window.print(); }, 400); };
        </script>
      </body>
      </html>
    `);
    win.document.close();
  };

  const renderPrintQRs = () => {
    if (!printQRs) return null;
    return (
      <div className="print-overlay">
        <div className="print-toolbar no-print">
          <span className="print-toolbar-title">QR Codes — {selectedBatch.name}</span>
          <div className="print-toolbar-actions">
            <button className="print-go-btn" onClick={() => handlePrint('portrait')} style={{ marginRight: 6 }}>🖨 Portrait (6/page)</button>
            <button className="print-go-btn" onClick={() => handlePrint('landscape')}>🖨 Landscape (10/page)</button>
            <button className="print-close-btn" onClick={() => setPrintQRs(null)}>✕ Close</button>
          </div>
        </div>
        <div className="print-sheet">
          {printQRs.map((item, i) => (
            <div key={i} className="qr-card-print">
              {item.photo
                ? <img src={item.photo} alt={item.name} className="qr-print-avatar" />
                : <span className="qr-print-icon"><User size={22} /></span>
              }
              <img src={item.dataUrl} alt="QR" className="qr-print-code" />
              <p className="qr-print-name">{item.name}</p>
              <p className="qr-print-batch">{selectedBatch.name}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };


  // Cross-platform haptic — works on Android (Vibration API) + iOS (AudioContext click)
  const haptic = (type = 'light') => {
    // Android / some browsers
    if (navigator.vibrate) {
      if (type === 'light') navigator.vibrate(10);
      else if (type === 'medium') navigator.vibrate(30);
      else if (type === 'success') navigator.vibrate([15, 30, 15]);
    }
    // iOS Safari — AudioContext short click triggers taptic engine indirectly
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === 'light') {
        osc.frequency.value = 1000;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.04);
      } else if (type === 'medium') {
        osc.frequency.value = 600;
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.07);
      } else if (type === 'success') {
        // Two-tone success click
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.setValueAtTime(900, ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
      }
      setTimeout(() => ctx.close(), 200);
    } catch {}
  };

  // ── helpers (keep state + ref in sync) ───────────────────────────────────
  const setDist = (v) => { pullDistanceRef.current = v; setPullDistance(v); };
  const setTriggered = (v) => { pullTriggeredRef.current = v; setPullTriggered(v); };
  const setRefreshing = (v) => { pullRefreshingRef.current = v; setPullRefreshing(v); };

  // ── Pull-to-refresh handlers (window scroll — body is the scroller) ───────
  const onTouchStart = (e) => {
    if (pullRefreshingRef.current) return;
    // Only arm when the page is truly at the very top
    if (window.scrollY > 0) { pullStartY.current = null; return; }
    pullStartY.current = e.touches[0].clientY;
    pullScrollY.current = window.scrollY;
  };

  const onTouchMove = (e) => {
    if (pullStartY.current === null) return;
    if (pullRefreshingRef.current) return;

    // If the page scrolled down since touchstart, the user is scrolling — disarm
    if (window.scrollY > 0) {
      pullStartY.current = null;
      setDist(0); setTriggered(false);
      return;
    }

    const dy = e.touches[0].clientY - pullStartY.current;

    // Must be a clear downward drag
    if (dy <= 0) {
      setDist(0); setTriggered(false);
      return;
    }

    // Rubber-band resistance: feels heavy like native
    const resistance = 0.45;
    const dist = Math.min(dy * resistance, 120);
    setDist(dist);

    if (dist >= PULL_THRESHOLD && !pullTriggeredRef.current) {
      setTriggered(true);
      haptic('medium');
    } else if (dist < PULL_THRESHOLD && pullTriggeredRef.current) {
      setTriggered(false);
    }
  };

  const onTouchEnd = async () => {
    if (pullDistanceRef.current >= PULL_THRESHOLD && !pullRefreshingRef.current) {
      pullStartY.current = null;
      setDist(0); setTriggered(false);
      setRefreshing(true);
      haptic('success');
      try {
        if (isViewer) await fetchBatches(null);
        else if (selectedTeacher) await fetchBatches(selectedTeacher._id);
      } finally {
        setRefreshing(false);
      }
    } else {
      pullStartY.current = null;
      setDist(0); setTriggered(false);
    }
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ position: 'relative' }}
    >
      {/* ── Pull-to-refresh indicator ── */}
      {(pullDistance > 0 || pullRefreshing) && (() => {
        const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
        const circleSize = 44;
        const radius = 16;
        const circumference = 2 * Math.PI * radius;
        const dashOffset = circumference * (1 - (pullTriggered ? 1 : progress));
        const rotate = pullTriggered || pullRefreshing ? 180 : progress * 200;

        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            display: 'flex', justifyContent: 'center',
            paddingTop: 10,
            pointerEvents: 'none',
          }}>
            <div style={{
              width: circleSize, height: circleSize,
              borderRadius: '50%',
              background: pullTriggered || pullRefreshing
                ? 'linear-gradient(135deg, #8B0000, #c0392b)'
                : 'rgba(255,255,255,0.97)',
              boxShadow: pullTriggered || pullRefreshing
                ? '0 4px 20px rgba(139,0,0,0.4)'
                : '0 2px 14px rgba(0,0,0,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: `scale(${0.65 + progress * 0.35})`,
              transition: 'background 0.2s, box-shadow 0.2s, transform 0.1s',
            }}>
              {pullRefreshing ? (
                <svg width={circleSize} height={circleSize} viewBox={`0 0 ${circleSize} ${circleSize}`}
                  style={{ position: 'absolute', animation: 'ptr-spin 0.75s linear infinite' }}>
                  <circle cx={circleSize/2} cy={circleSize/2} r={radius}
                    fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
                  <circle cx={circleSize/2} cy={circleSize/2} r={radius}
                    fill="none" stroke="#fff" strokeWidth="2.5"
                    strokeDasharray={circumference} strokeDashoffset={circumference * 0.72}
                    strokeLinecap="round"
                    transform={`rotate(-90 ${circleSize/2} ${circleSize/2})`} />
                </svg>
              ) : (
                <svg width={circleSize} height={circleSize} viewBox={`0 0 ${circleSize} ${circleSize}`}
                  style={{ position: 'absolute' }}>
                  <circle cx={circleSize/2} cy={circleSize/2} r={radius}
                    fill="none" stroke="rgba(139,0,0,0.12)" strokeWidth="2.5" />
                  <circle cx={circleSize/2} cy={circleSize/2} r={radius}
                    fill="none" stroke={pullTriggered ? '#fff' : '#8B0000'} strokeWidth="2.5"
                    strokeDasharray={circumference} strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                    transform={`rotate(-90 ${circleSize/2} ${circleSize/2})`}
                    style={{ transition: 'stroke-dashoffset 0.06s, stroke 0.2s' }} />
                </svg>
              )}
              <svg width="16" height="16" viewBox="0 0 16 16" style={{
                position: 'relative', zIndex: 1,
                transform: `rotate(${rotate}deg)`,
                transition: pullTriggered ? 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)' : 'transform 0.1s',
              }}>
                <path d="M8 2 L8 11 M4 7 L8 11 L12 7"
                  stroke={pullTriggered || pullRefreshing ? '#fff' : '#8B0000'}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
                  style={{ transition: 'stroke 0.2s' }} />
              </svg>
            </div>
          </div>
        );
      })()}
      <style>{`
        @keyframes ptr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .search-input::placeholder { color: rgba(255,255,255,0.55) !important; }
        .search-input:focus { outline: none; background: rgba(255,255,255,0.25) !important; }
      `}</style>
      {view === 'batches' && (['setouchi','wbc','gyoumusuishin','greenservices'].includes(safeLocalGet(ROLE_KEY)) ? renderCompanyGroups() : renderBatches())}
      {view === 'students' && renderStudents()}
      {view === 'categories' && renderCategories()}
      {view === 'evaluations' && renderEvaluations()}
      {view === 'evaluationDetail' && renderEvaluationDetail()}
      {view === 'examItems' && renderExamItems()}
      {view === 'examDetail' && renderExamDetail()}
      {renderModal()}
      {renderMoveModal()}
      {renderPrintQRs()}
      {showQuickAddExam && selectedStudent && (
        <QuickAddExamModal
          student={selectedStudent}
          categories={selectedStudent?.categories || []}
          onSave={handleQuickAddExamSave}
          onClose={() => setShowQuickAddExam(false)}
        />
      )}

      {showQRScanner && (
        <QRScanner
          onResult={handleQRResult}
          onClose={() => setShowQRScanner(false)}
        />
      )}
      {showScanner && (
        <DocumentScanner
          bulkMode={true}
          onCapture={handleScanCapture}
          onClose={() => { setShowScanner(false); setScanningExamId(null); }}
        />
      )}
      {imageViewer && (
        <ImageViewer
          images={imageViewer.images}
          startIndex={imageViewer.index}
          onClose={() => setImageViewer(null)}
        />
      )}
      {showSettings && (
        <SettingsPage
          batches={batches}
          onClose={() => setShowSettings(false)}
          API={API}
        />
      )}
      {showProgressChart && progressChartStudent && (
        <ProgressChart
          student={progressChartStudent}
          batch={selectedBatch}
          onClose={() => { setShowProgressChart(false); setProgressChartStudent(null); }}
        />
      )}
      {showParentQR && parentQRStudent && (
        <ParentQRPopup
          student={parentQRStudent}
          batch={selectedBatch}
          teacher={selectedTeacher}
          onClose={() => { setShowParentQR(false); setParentQRStudent(null); }}
        />
      )}
    </div>
  );
}

export default App;