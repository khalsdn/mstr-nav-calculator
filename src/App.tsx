import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { RefreshCw, Bitcoin, DollarSign, TrendingUp, Calculator, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { COINBASE_WS_SUBSCRIBE, COINBASE_WS_URL, fetchBtcPrice, fetchEurRate as fetchUsdEurRate, fetchMstrQuote } from '@/lib/prices';

// Default values from Strategy.com (as of March 2026)
const DEFAULT_VALUES = {
  btcHoldings: 761068,
  basicShares: 345084000, // Basic shares, not diluted
  usdReserve: 2250, // in millions
  debt: 8254, // in millions (includes all indebtedness)
  preferredStock: 10000, // in millions
};

const STORAGE_KEY = 'mstr-nav-inputs';

interface PersistedInputs {
  mstrPrice: number;
  btcHoldings: number;
  basicShares: number;
  usdReserve: number;
  debt: number;
  preferredStock: number;
  isAutoMstr: boolean;
  alertThreshold?: number;
  robinhoodProxyUrl?: string;
}

function loadPersistedInputs(): Partial<PersistedInputs> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load persisted inputs:', e);
  }
  return {};
}

function saveInputs(inputs: PersistedInputs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
  } catch (e) {
    console.warn('Failed to save inputs:', e);
  }
}

interface NavData {
  btcPrice: number;
  mstrPrice: number;
  btcHoldings: number;
  basicShares: number;
  usdReserve: number;
  debt: number;
  preferredStock: number;
}

interface NavResult {
  btcValue: number;
  marketCap: number;
  enterpriseValue: number;
  mnav: number;
  navPerShare: number;
  traditionalMnav: number;
}

function calculateNav(data: NavData): NavResult {
  // BTC Value
  const btcValue = data.btcHoldings * data.btcPrice;
  
  // Market Cap = MSTR Price × Basic Shares Outstanding
  const marketCap = data.mstrPrice * data.basicShares;
  
  // Enterprise Value = Market Cap + Debt + Preferred - Cash
  const enterpriseValue = marketCap + (data.debt * 1000000) + (data.preferredStock * 1000000) - (data.usdReserve * 1000000);
  
  // Strategy's mNAV = Enterprise Value / BTC Reserve
  const mnav = enterpriseValue / btcValue;
  
  // Traditional NAV per share (for reference)
  const totalAssets = btcValue + (data.usdReserve * 1000000);
  const totalLiabilities = (data.debt * 1000000) + (data.preferredStock * 1000000);
  const nav = totalAssets - totalLiabilities;
  const navPerShare = nav / data.basicShares;
  
  // Traditional mNAV = MSTR Price / NAV per Share
  const traditionalMnav = data.mstrPrice / navPerShare;

  return {
    btcValue,
    marketCap,
    enterpriseValue,
    mnav,
    navPerShare,
    traditionalMnav,
  };
}

function formatNumber(num: number, decimals: number = 0): string {
  if (decimals === 0) {
    return num.toLocaleString('en-US');
  }
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCurrency(num: number, decimals: number = 0): string {
  return '$' + formatNumber(num, decimals);
}

function formatBillions(num: number): string {
  return '$' + (num / 1000000000).toFixed(2) + 'B';
}

function formatMillions(num: number): string {
  return '$' + (num / 1000000).toFixed(0) + 'M';
}

export default function App() {
  const persisted = loadPersistedInputs();

  const [btcPrice, setBtcPrice] = useState<number>(68179);
  const [isLoadingBtc, setIsLoadingBtc] = useState(false);
  const [btcLastUpdated, setBtcLastUpdated] = useState<Date | null>(null);
  const [btcSource, setBtcSource] = useState<string | null>(null);
  const [btcError, setBtcError] = useState<string | null>(null);
  const [isBtcLive, setIsBtcLive] = useState(false);
  const lastBtcTickRef = useRef(0);
  
  const [mstrPrice, setMstrPrice] = useState<number>(persisted.mstrPrice ?? 135.66);
  const [isAutoMstr, setIsAutoMstr] = useState<boolean>(persisted.isAutoMstr ?? true);
  const [isLoadingMstr, setIsLoadingMstr] = useState(false);
  const [mstrLastUpdated, setMstrLastUpdated] = useState<Date | null>(null);
  const [mstrSource, setMstrSource] = useState<string | null>(null);
  const [mstrError, setMstrError] = useState<string | null>(null);
  const [robinhoodProxyUrl, setRobinhoodProxyUrl] = useState<string>(persisted.robinhoodProxyUrl ?? '');
  // Read through a ref so typing the URL doesn't restart the polling interval
  const robinhoodProxyUrlRef = useRef(robinhoodProxyUrl);
  robinhoodProxyUrlRef.current = robinhoodProxyUrl;
  const [eurRate, setEurRate] = useState<number | null>(null);

  const [currentTime, setCurrentTime] = useState(new Date());
  const hasNotifiedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission().catch(e => console.warn('Could not request notification permission', e));
    }
  }, []);

  const formatTimeSince = (lastUpdatedDate: Date | null) => {
    if (!lastUpdatedDate) return 'Fetching...';
    const diffMs = currentTime.getTime() - lastUpdatedDate.getTime();
    if (diffMs < 0) return 'Just now';
    const diffSecs = Math.floor(diffMs / 1000);
    const mins = Math.floor(diffSecs / 60);
    const secs = diffSecs % 60;
    if (mins === 0) return `${secs}s ago`;
    return `${mins}m ${secs}s ago`;
  };

  const getUpdateColor = (lastUpdatedDate: Date | null) => {
    if (!lastUpdatedDate) return 'text-slate-500';
    const diffMins = (currentTime.getTime() - lastUpdatedDate.getTime()) / 60000;
    if (diffMins < 2) return 'text-green-500';
    if (diffMins <= 5) return 'text-orange-500';
    return 'text-red-500';
  };
  
  const [btcHoldings, setBtcHoldings] = useState<number>(persisted.btcHoldings ?? DEFAULT_VALUES.btcHoldings);
  const [basicShares, setBasicShares] = useState<number>(persisted.basicShares ?? DEFAULT_VALUES.basicShares);
  const [usdReserve, setUsdReserve] = useState<number>(persisted.usdReserve ?? DEFAULT_VALUES.usdReserve);
  const [debt, setDebt] = useState<number>(persisted.debt ?? DEFAULT_VALUES.debt);
  const [preferredStock, setPreferredStock] = useState<number>(persisted.preferredStock ?? DEFAULT_VALUES.preferredStock);
  const [alertThreshold, setAlertThreshold] = useState<number>(persisted.alertThreshold ?? 1.18);

  const fetchBitcoinPrice = useCallback(async () => {
    setIsLoadingBtc(true);
    try {
      const { price, source } = await fetchBtcPrice();
      setBtcPrice(price);
      setBtcSource(source);
      setBtcLastUpdated(new Date());
      setBtcError(null);
    } catch (error) {
      console.error('Failed to fetch Bitcoin price:', error);
      setBtcError('Could not fetch BTC price');
    } finally {
      setIsLoadingBtc(false);
    }
  }, []);

  const fetchMstrPrice = useCallback(async () => {
    if (!isAutoMstr) return;
    setIsLoadingMstr(true);
    try {
      const { price, source } = await fetchMstrQuote(robinhoodProxyUrlRef.current);
      setMstrPrice(price);
      setMstrSource(source);
      setMstrLastUpdated(new Date());
      setMstrError(null);
    } catch (error) {
      console.error('Failed to fetch MSTR price:', error);
      setMstrError('Could not fetch MSTR price');
    } finally {
      setIsLoadingMstr(false);
    }
  }, [isAutoMstr]);

  const fetchEurRate = useCallback(async () => {
    try {
      setEurRate(await fetchUsdEurRate());
    } catch (error) {
      console.error('Failed to fetch EUR rate:', error);
    }
  }, []);

  // Live BTC price from the Coinbase WebSocket (every trade), applied at most once per second
  useEffect(() => {
    let ws: WebSocket | null = null;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingPrice: number | null = null;

    const connect = () => {
      ws = new WebSocket(COINBASE_WS_URL);
      ws.onopen = () => ws?.send(COINBASE_WS_SUBSCRIBE);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const price = Number(msg.price);
          if (msg.type === 'ticker' && price > 0) pendingPrice = price;
        } catch { /* ignore malformed messages */ }
      };
      ws.onclose = () => {
        setIsBtcLive(false);
        if (!disposed) reconnectTimer = setTimeout(connect, 5000);
      };
      ws.onerror = () => ws?.close();
    };

    const flush = setInterval(() => {
      if (pendingPrice === null) return;
      setBtcPrice(pendingPrice);
      setBtcSource('Coinbase · live');
      setBtcLastUpdated(new Date());
      setBtcError(null);
      setIsBtcLive(true);
      lastBtcTickRef.current = Date.now();
      pendingPrice = null;
    }, 1000);

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearInterval(flush);
      ws?.close();
    };
  }, []);

  // REST fallback: poll BTC only when the WebSocket has gone quiet
  useEffect(() => {
    fetchBitcoinPrice();
    const interval = setInterval(() => {
      if (Date.now() - lastBtcTickRef.current > 10000) fetchBitcoinPrice();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchBitcoinPrice]);

  // EUR rate changes slowly; refresh every 5 minutes
  useEffect(() => {
    fetchEurRate();
    const interval = setInterval(fetchEurRate, 300000);
    return () => clearInterval(interval);
  }, [fetchEurRate]);

  // Fetch MSTR price separately because it depends on isAutoMstr
  useEffect(() => {
    if (isAutoMstr) {
      fetchMstrPrice();
      const interval = setInterval(() => {
        fetchMstrPrice();
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [isAutoMstr, fetchMstrPrice]);

  // Persist input values to localStorage whenever they change
  useEffect(() => {
    saveInputs({ mstrPrice, btcHoldings, basicShares, usdReserve, debt, preferredStock, isAutoMstr, alertThreshold, robinhoodProxyUrl });
  }, [mstrPrice, btcHoldings, basicShares, usdReserve, debt, preferredStock, isAutoMstr, alertThreshold, robinhoodProxyUrl]);

  const navData: NavData = {
    btcPrice,
    mstrPrice,
    btcHoldings,
    basicShares,
    usdReserve,
    debt,
    preferredStock,
  };

  const result = calculateNav(navData);

  // Update browser tab title
  useEffect(() => {
    document.title = result.mnav > 0 ? `mNAV: ${result.mnav.toFixed(4)} | MSTR Calculator` : 'MSTR NAV Calculator';
  }, [result.mnav]);

  // Handle mNAV threshold notifications
  useEffect(() => {
    if (result.mnav > 0 && result.mnav < alertThreshold) {
      if (!hasNotifiedRef.current) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('🚨 MSTR mNAV Alert 🚨', {
            body: `mNAV has dropped below ${alertThreshold}! (Current: ${result.mnav.toFixed(4)})\nOpen the app to see details.`,
            icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
            image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
            requireInteraction: true,
            vibrate: [200, 100, 200]
          } as NotificationOptions & { image?: string });
        }
        hasNotifiedRef.current = true;
      }
    } else if (result.mnav >= alertThreshold) {
      hasNotifiedRef.current = false;
    }
  }, [result.mnav, alertThreshold]);

  const resetToDefaults = () => {
    setBtcHoldings(DEFAULT_VALUES.btcHoldings);
    setBasicShares(DEFAULT_VALUES.basicShares);
    setUsdReserve(DEFAULT_VALUES.usdReserve);
    setDebt(DEFAULT_VALUES.debt);
    setPreferredStock(DEFAULT_VALUES.preferredStock);
    setAlertThreshold(1.18);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-8 px-4 selection:bg-blue-500 selection:text-white">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            <span className="bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent">
              MSTR
            </span>{' '}
            NAV Calculator
          </h1>
          <p className="text-slate-400">
            Real-time mNAV calculator for Strategy (MicroStrategy)
          </p>
        </div>

        {/* Main Result Card */}
        <Card className="mb-6 bg-gradient-to-r from-orange-500/20 to-yellow-500/20 border-orange-500/50">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <p className="text-sm text-slate-400 mb-1">mNAV Ratio</p>
                <p className="text-5xl font-bold text-white">
                  {formatNumber(result.mnav, 4)}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Enterprise Value / BTC Reserve
                </p>
              </div>
              <div className="text-center border-l border-r border-slate-600/50">
                <p className="text-sm text-slate-400 mb-1">Enterprise Value</p>
                <p className="text-3xl font-bold text-emerald-400">
                  {formatBillions(result.enterpriseValue)}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Market Cap + Debt + Pref - Cash
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-slate-400 mb-1">BTC Reserve</p>
                <p className="text-3xl font-bold text-blue-400">
                  {formatBillions(result.btcValue)}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  BTC Holdings × BTC Price
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Section */}
          <div className="space-y-6">
            {/* Bitcoin Price Card */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 text-orange-400">
                  <Bitcoin className="w-5 h-5" />
                  Bitcoin Price
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-slate-500 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Live from the Coinbase WebSocket; falls back to Coinbase / Kraken / Binance REST if the stream drops</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      type="number"
                      value={btcPrice}
                      onChange={(e) => setBtcPrice(Number(e.target.value))}
                      className="text-lg bg-slate-900 border-slate-600 text-white"
                      placeholder="Bitcoin Price"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={fetchBitcoinPrice}
                    disabled={isLoadingBtc}
                    className="border-slate-600 hover:bg-slate-700"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoadingBtc ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                <p className={`text-xs mt-2 transition-colors duration-300 ${getUpdateColor(btcLastUpdated)}`}>
                  {isBtcLive && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse mr-1.5" />}
                  Updated: {formatTimeSince(btcLastUpdated)}
                  {btcSource && <span className="text-slate-500"> · {btcSource}</span>}
                </p>
                {btcError && <p className="text-xs text-red-400 mt-1">{btcError}</p>}
              </CardContent>
            </Card>

            {/* MSTR Price Card */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg flex items-center gap-2 text-blue-400">
                    <TrendingUp className="w-5 h-5" />
                    MSTR Stock Price
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-4 h-4 text-slate-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{isAutoMstr ? 'Every 15 seconds from Robinhood (via your proxy or a CORS extension); otherwise CNBC from 4am-8pm ET and the Hyperliquid 24/7 MSTR perp overnight and on weekends' : 'Enter the current MSTR stock price manually'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="auto-mstr" className="text-xs text-slate-400">Auto</Label>
                    <Switch 
                      id="auto-mstr" 
                      checked={isAutoMstr} 
                      onCheckedChange={setIsAutoMstr} 
                      className="data-[state=checked]:bg-blue-500"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.01"
                      value={mstrPrice}
                      onChange={(e) => setMstrPrice(Number(e.target.value))}
                      disabled={isAutoMstr}
                      className="text-lg bg-slate-900 border-slate-600 text-white disabled:opacity-50"
                      placeholder="MSTR Stock Price"
                    />
                  </div>
                  {isAutoMstr && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={fetchMstrPrice}
                      disabled={isLoadingMstr}
                      className="border-slate-600 hover:bg-slate-700"
                    >
                      <RefreshCw className={`w-4 h-4 ${isLoadingMstr ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-1 mt-2">
                  {eurRate && mstrPrice && (
                    <p className="text-xs text-slate-400">
                      ≈ €{(mstrPrice * eurRate).toFixed(2)} EUR
                    </p>
                  )}
                  {isAutoMstr && (
                    <p className={`text-xs transition-colors duration-300 ${getUpdateColor(mstrLastUpdated)}`}>
                      Updated: {formatTimeSince(mstrLastUpdated)}
                      {mstrSource && <span className="text-slate-500"> · {mstrSource}</span>}
                    </p>
                  )}
                  {isAutoMstr && mstrError && <p className="text-xs text-red-400">{mstrError}</p>}
                  {isAutoMstr && (
                    <div className="mt-2">
                      <Label htmlFor="robinhood-proxy" className="text-xs text-slate-400">
                        Robinhood proxy URL (optional, see proxy/README.md)
                      </Label>
                      <Input
                        id="robinhood-proxy"
                        type="url"
                        value={robinhoodProxyUrl}
                        onChange={(e) => setRobinhoodProxyUrl(e.target.value)}
                        onBlur={fetchMstrPrice}
                        className="mt-1 h-8 text-xs bg-slate-900 border-slate-600 text-white"
                        placeholder="https://mstr-robinhood.your-name.workers.dev"
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Holdings Card */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 text-emerald-400">
                  <Calculator className="w-5 h-5" />
                  BTC Holdings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Input
                  type="number"
                  value={btcHoldings}
                  onChange={(e) => setBtcHoldings(Number(e.target.value))}
                  className="text-lg bg-slate-900 border-slate-600 text-white"
                  placeholder="BTC Holdings"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Total Bitcoin held by Strategy
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Advanced Settings */}
          <div className="space-y-6">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg flex items-center gap-2 text-purple-400">
                    <DollarSign className="w-5 h-5" />
                    Advanced Settings
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetToDefaults}
                    className="text-slate-400 hover:text-white"
                  >
                    Reset to Defaults
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-slate-400 mb-1 block">Basic Shares Outstanding</Label>
                  <Input
                    type="number"
                    value={basicShares}
                    onChange={(e) => setBasicShares(Number(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white"
                    placeholder="Shares Outstanding"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Basic shares (not diluted) - used for Market Cap calculation
                  </p>
                </div>

                <div>
                  <Label className="text-slate-400 mb-1 block">USD Reserve ($M)</Label>
                  <Input
                    type="number"
                    value={usdReserve}
                    onChange={(e) => setUsdReserve(Number(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white"
                    placeholder="USD Reserve"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Cash and cash equivalents in millions
                  </p>
                </div>

                <div>
                  <Label className="text-slate-400 mb-1 block">Total Debt ($M)</Label>
                  <Input
                    type="number"
                    value={debt}
                    onChange={(e) => setDebt(Number(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white"
                    placeholder="Total Debt"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Aggregate principal amount of all indebtedness in millions
                  </p>
                </div>

                <div>
                  <Label className="text-slate-400 mb-1 block">Preferred Stock ($M)</Label>
                  <Input
                    type="number"
                    value={preferredStock}
                    onChange={(e) => setPreferredStock(Number(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white"
                    placeholder="Preferred Stock"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Aggregate notional value of perpetual preferred stock in millions
                  </p>
                </div>

                <div className="pt-4 mt-2 border-t border-slate-700">
                  <Label className="text-slate-400 mb-1 block">mNAV Alert Threshold</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(Number(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white"
                    placeholder="e.g. 1.18"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Receive a desktop notification if mNAV drops below this value
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Breakdown Card */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-slate-200">mNAV Calculation Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-700">
                  <span className="text-slate-400">Market Cap</span>
                  <span className="text-blue-400 font-mono">{formatBillions(result.marketCap)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700">
                  <span className="text-slate-400">Plus: Debt</span>
                  <span className="text-red-400 font-mono">+{formatMillions(debt * 1000000)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700">
                  <span className="text-slate-400">Plus: Preferred</span>
                  <span className="text-red-400 font-mono">+{formatMillions(preferredStock * 1000000)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700">
                  <span className="text-slate-400">Less: Cash</span>
                  <span className="text-green-400 font-mono">-{formatMillions(usdReserve * 1000000)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700 bg-slate-700/30 px-3 rounded">
                  <span className="text-white font-semibold">Enterprise Value</span>
                  <span className="text-emerald-400 font-bold font-mono">{formatBillions(result.enterpriseValue)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-700">
                  <span className="text-slate-400">Divided by: BTC Reserve</span>
                  <span className="text-orange-400 font-mono">{formatBillions(result.btcValue)}</span>
                </div>
                <div className="flex justify-between items-center py-3 bg-orange-500/20 px-3 rounded-lg mt-2">
                  <span className="text-white font-semibold">mNAV Ratio</span>
                  <span className="text-orange-400 font-bold font-mono text-xl">{formatNumber(result.mnav, 4)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Traditional NAV Reference */}
        <Card className="mt-6 bg-slate-800/30 border-slate-700/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-slate-500">Traditional NAV (for reference)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-slate-500">NAV per Share</p>
                <p className="text-lg text-slate-300">{formatCurrency(result.navPerShare, 2)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Traditional mNAV (Price/NAV)</p>
                <p className="text-lg text-slate-300">{formatNumber(result.traditionalMnav, 4)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total NAV</p>
                <p className="text-lg text-slate-300">{formatBillions(result.navPerShare * basicShares)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-8 text-center text-slate-500 text-sm">
          <p>mNAV = Enterprise Value / BTC Reserve (per Strategy's definition)</p>
          <p className="mt-1">Enterprise Value = Market Cap + Debt + Preferred - Cash</p>
          <p className="mt-1">Data sourced from Strategy.com (formerly MicroStrategy)</p>
        </div>
      </div>
    </div>
  );
}
