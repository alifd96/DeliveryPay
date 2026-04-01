/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { App as CapApp } from '@capacitor/app';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  Search, 
  Trash2, 
  Calculator, 
  Truck,
  User, 
  Store, 
  History, 
  LogOut, 
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Wallet,
  ReceiptText,
  CalendarDays,
  Phone,
  MapPin,
  Share2,
  Edit3,
  X,
  Check,
  MoreVertical,
  Package,
  MessageCircle,
  TrendingUp,
  Copy,
  Filter,
  ArrowUpRight,
  Clock,
  CheckCircle,
  CreditCard,
  Mic,
  RotateCcw,
  Volume2,
  ExternalLink
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  serverTimestamp,
  Timestamp,
  deleteDoc,
  doc,
  updateDoc,
  getDocFromServer
} from 'firebase/firestore';
import { db } from './firebase';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: 'default-user',
      email: 'local@user',
      emailVerified: true,
      isAnonymous: false,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

interface ShopItem {
  shop: string;
  price: number;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  uid: string;
  createdAt: Timestamp;
}

interface Order {
  id: string;
  customerId: string;
  customerName: string;
  items: ShopItem[];
  deliveryFee: number;
  total: number;
  status: 'pending' | 'delivered' | 'paid';
  uid: string;
  createdAt: Timestamp;
}

// --- Helpers ---

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-LB', {
    style: 'currency',
    currency: 'LBP',
    maximumFractionDigits: 0,
  }).format(amount).replace('LBP', 'L.L.');
};

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes('{"error":')) {
        setHasError(true);
        setErrorInfo(event.error.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full border border-red-100">
          <div className="flex items-center gap-4 text-red-600 mb-6">
            <div className="bg-red-100 p-3 rounded-2xl">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold">Security Alert</h1>
          </div>
          <p className="text-slate-600 mb-6 leading-relaxed">
            There was an issue with your permissions or the database rules. Please try logging in again.
          </p>
          <pre className="bg-slate-50 p-4 rounded-xl text-xs overflow-auto max-h-40 mb-6 text-slate-500 border border-slate-100">
            {errorInfo}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-black transition-all active:scale-95 shadow-lg"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const user = { uid: 'default-user', displayName: 'User' };
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'home' | 'customer' | 'history' | 'add-customer' | 'customer-profile' | 'stats'>('home');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);
  const [confirmMarkPaid, setConfirmMarkPaid] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  
  // Data State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'delivered' | 'paid'>('all');
  
  // Form State
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', address: '' });
  const [currentItems, setCurrentItems] = useState<ShopItem[]>([]);
  const [shopName, setShopName] = useState('');
  const [price, setPrice] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { items: ShopItem[], fee: string }>>(() => {
    const saved = localStorage.getItem('delivery_drafts');
    return saved ? JSON.parse(saved) : {};
  });

  // Save drafts to localStorage
  useEffect(() => {
    localStorage.setItem('delivery_drafts', JSON.stringify(drafts));
  }, [drafts]);

  // Auto-save current items and fee to drafts whenever they change
  useEffect(() => {
    if (selectedCustomer && view === 'customer-profile') {
      setDrafts(prev => ({
        ...prev,
        [selectedCustomer.id]: { items: currentItems, fee: deliveryFee }
      }));
    }
  }, [currentItems, deliveryFee, selectedCustomer, view]);

  // --- Back Button Handling ---
  useEffect(() => {
    const backListener = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (view === 'customer-profile' || view === 'add-customer' || view === 'history' || view === 'stats') {
        setView('home');
        setSelectedCustomer(null);
        setEditingCustomer(null);
      } else if (view === 'home') {
        CapApp.exitApp();
      }
    });

    return () => {
      backListener.then(l => l.remove());
    };
  }, [view, selectedCustomer, currentItems, deliveryFee]);

  const saveCurrentToDraft = (customerId: string | undefined) => {
    if (!customerId) return;
    setDrafts(prev => ({
      ...prev,
      [customerId]: { items: currentItems, fee: deliveryFee }
    }));
  };

  const selectCustomer = (customer: Customer) => {
    if (selectedCustomer?.id === customer.id) {
      setView('customer-profile');
      return;
    }

    // Save current state to drafts for the PREVIOUS customer immediately
    if (selectedCustomer) {
      setDrafts(prev => ({
        ...prev,
        [selectedCustomer.id]: { items: [...currentItems], fee: deliveryFee }
      }));
    }
    
    // Load state for the NEW customer from the current drafts
    const draft = drafts[customer.id] || { items: [], fee: '' };
    setCurrentItems([...draft.items]);
    setDeliveryFee(draft.fee);
    setShopName('');
    setPrice('');
    setSelectedCustomer(customer);
    setView('customer-profile');
  };

  const resetOrderState = (customerId?: string) => {
    setCurrentItems([]);
    setShopName('');
    setPrice('');
    setDeliveryFee('');
    setVoiceError(null);
    setIsListening(false);
    if (customerId) {
      setDrafts(prev => {
        const newDrafts = { ...prev };
        delete newDrafts[customerId];
        return newDrafts;
      });
    }
  };

  // --- Auth ---

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();
  }, []);

  const handleLogin = async () => {};
  const handleLogout = () => {};

  // --- Data Fetching ---

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'customers'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      setCustomers(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'customers');
    });

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'orders'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      setOrders(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'orders');
    });

    return unsubscribe;
  }, [user]);

  // --- Actions ---

  const saveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !customerForm.name.trim()) return;

    try {
      if (editingCustomer) {
        await updateDoc(doc(db, 'customers', editingCustomer.id), {
          ...customerForm
        });
      } else {
        await addDoc(collection(db, 'customers'), {
          ...customerForm,
          uid: user.uid,
          createdAt: serverTimestamp()
        });
      }
      setCustomerForm({ name: '', phone: '', address: '' });
      setEditingCustomer(null);
      setView('home');
    } catch (error) {
      handleFirestoreError(error, editingCustomer ? OperationType.UPDATE : OperationType.CREATE, 'customers');
    }
  };

  const deleteCustomer = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'customers', id));
      setConfirmDeleteId(null);
      setDrafts(prev => {
        const newDrafts = { ...prev };
        delete newDrafts[id];
        return newDrafts;
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `customers/${id}`);
    }
  };

  const addItemToOrder = () => {
    if (!shopName.trim() || !price) return;
    setCurrentItems([...currentItems, { shop: shopName.trim(), price: parseFloat(price) }]);
    setShopName('');
    setPrice('');
  };

  const removeItemFromOrder = (index: number) => {
    setCurrentItems(currentItems.filter((_, i) => i !== index));
  };

  const submitOrder = async () => {
    if (!user || !selectedCustomer || currentItems.length === 0) return;

    const itemsTotal = currentItems.reduce((sum, item) => sum + item.price, 0);
    const fee = parseFloat(deliveryFee) || 0;
    const total = itemsTotal + fee;

    try {
      await addDoc(collection(db, 'orders'), {
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        items: currentItems,
        deliveryFee: fee,
        total,
        status: 'pending',
        uid: user.uid,
        createdAt: serverTimestamp()
      });
      resetOrderState(selectedCustomer.id);
      setView('history');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'orders');
    }
  };

  const deleteOrder = async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      setConfirmDeleteOrderId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `orders/${orderId}`);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: 'pending' | 'delivered' | 'paid') => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const markAllAsPaid = async () => {
    if (!selectedCustomer) return;
    const unpaidOrders = orders.filter(o => o.customerId === selectedCustomer.id && o.status !== 'paid');
    try {
      await Promise.all(unpaidOrders.map(o => updateDoc(doc(db, 'orders', o.id), { status: 'paid' })));
      setConfirmMarkPaid(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'orders/multiple');
    }
  };

  const shareToWhatsApp = (order: Order) => {
    const itemsText = order.items.map(item => `- ${item.shop}: ${formatCurrency(item.price)}`).join('\n');
    const text = `*Delivery Bill for ${order.customerName}*\n\n${itemsText}\n\n*Delivery Fee:* ${formatCurrency(order.deliveryFee)}\n*Total:* ${formatCurrency(order.total)}\n\n*Status:* ${order.status.toUpperCase()}\n\nThank you!`;
    const phone = customers.find(c => c.id === order.customerId)?.phone || selectedCustomer?.phone;
    const url = `https://wa.me/${phone?.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const startVoiceCapture = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("Voice recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ar-LB'; // Support Lebanese Arabic
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      // Simple parsing: "Supermarket 5000" or just "Supermarket"
      const parts = transcript.split(' ');
      if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        const numericPrice = parseFloat(lastPart.replace(/\D/g, ''));
        if (!isNaN(numericPrice)) {
          setShopName(parts.slice(0, -1).join(' '));
          setPrice(numericPrice.toString());
          return;
        }
      }
      setShopName(transcript);
    };

    recognition.start();
  };

  const copyToClipboard = (order: Order) => {
    const itemsText = order.items.map(item => `- ${item.shop}: ${formatCurrency(item.price)}`).join('\n');
    const text = `Delivery Bill for ${order.customerName}\n\n${itemsText}\n\nDelivery Fee: ${formatCurrency(order.deliveryFee)}\nTotal: ${formatCurrency(order.total)}\n\nStatus: ${order.status.toUpperCase()}`;
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  // --- Helpers ---

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).map(customer => {
      const customerOrders = orders.filter(o => o.customerId === customer.id);
      const unpaidOrders = customerOrders.filter(o => o.status !== 'paid');
      const unpaidBalance = unpaidOrders.reduce((sum, o) => sum + o.total, 0);
      
      let oldestDebtDays = 0;
      if (unpaidOrders.length > 0) {
        const oldestDate = new Date(Math.min(...unpaidOrders.map(o => o.createdAt?.toDate().getTime() || Date.now())));
        oldestDebtDays = Math.floor((Date.now() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      return { ...customer, unpaidBalance, oldestDebtDays };
    });
  }, [customers, searchQuery, orders]);

  const currentTotal = useMemo(() => {
    const itemsTotal = currentItems.reduce((sum, item) => sum + item.price, 0);
    return itemsTotal + (parseFloat(deliveryFee) || 0);
  }, [currentItems, deliveryFee]);

  const stats = useMemo(() => {
    const totalEarned = orders.reduce((sum, o) => sum + o.total, 0);
    const totalDebt = orders.filter(o => o.status !== 'paid').reduce((sum, o) => sum + o.total, 0);
    
    // Chart data for last 7 days
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().split('T')[0];
    }).reverse();

    const chartData = last7Days.map(date => {
      const dayOrders = orders.filter(o => o.createdAt?.toDate().toISOString().split('T')[0] === date);
      return {
        date: new Date(date).toLocaleDateString('en-LB', { weekday: 'short' }),
        amount: dayOrders.reduce((sum, o) => sum + o.total, 0)
      };
    });

    // Customer specific stats
    const customerStats = selectedCustomer ? {
      totalSpent: orders.filter(o => o.customerId === selectedCustomer.id).reduce((sum, o) => sum + o.total, 0),
      orderCount: orders.filter(o => o.customerId === selectedCustomer.id).length,
      lastOrder: orders.filter(o => o.customerId === selectedCustomer.id)[0]?.createdAt?.toDate()
    } : null;

    // Top Customers
    const topCustomers = customers.map(c => ({
      ...c,
      totalSpent: orders.filter(o => o.customerId === c.id).reduce((sum, o) => sum + o.total, 0)
    })).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 5);

    // Debt Aging
    const unpaidOrders = orders.filter(o => o.status !== 'paid');
    const debtAging = {
      recent: unpaidOrders.filter(o => {
        const days = Math.floor((Date.now() - (o.createdAt?.toDate().getTime() || Date.now())) / (1000 * 60 * 60 * 24));
        return days <= 7;
      }).reduce((sum, o) => sum + o.total, 0),
      mid: unpaidOrders.filter(o => {
        const days = Math.floor((Date.now() - (o.createdAt?.toDate().getTime() || Date.now())) / (1000 * 60 * 60 * 24));
        return days > 7 && days <= 30;
      }).reduce((sum, o) => sum + o.total, 0),
      old: unpaidOrders.filter(o => {
        const days = Math.floor((Date.now() - (o.createdAt?.toDate().getTime() || Date.now())) / (1000 * 60 * 60 * 24));
        return days > 30;
      }).reduce((sum, o) => sum + o.total, 0),
    };

    return { totalEarned, totalDebt, orderCount: orders.length, chartData, customerStats, topCustomers, debtAging };
  }, [orders, selectedCustomer, customers]);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const matchesSearch = o.customerName.toLowerCase().includes(historySearchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, historySearchQuery, statusFilter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="space-y-0">
              <h1 className="text-base font-black tracking-tighter text-slate-900">
                {view === 'home' ? 'DeliveryHelp' : 
                 view === 'stats' ? 'Statistics' :
                 view === 'add-customer' ? (editingCustomer ? 'Edit Client' : 'New Client') : 
                 view === 'customer-profile' ? 'Client Profile' :
                 selectedCustomer?.name}
              </h1>
              {view === 'home' && (
                <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">
                  WELCOME, {user?.displayName?.split(' ')[0] || 'USER'}
                </p>
              )}
            </div>
              {view !== 'home' && (
                <button 
                  onClick={() => {
                    setEditingCustomer(null);
                    setView('home');
                    setSelectedCustomer(null);
                  }}
                  className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all active:scale-90 text-slate-600"
                >
                  <ArrowLeft size={20} strokeWidth={3} />
                </button>
              )}
          </div>
        </header>

        <main className="max-w-xl mx-auto p-4">
          <AnimatePresence mode="wait">
            <motion.div 
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="transition-all duration-200"
            >
              {view === 'home' && (
                <div key="home" className="space-y-4">
                  {/* Summary Card */}
                  <div className="bg-white rounded-[1.5rem] p-4 text-slate-900 shadow-lg shadow-slate-200/40 border border-slate-100">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="border-r border-slate-100 pr-3">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Admin Outstanding</p>
                        <p className="text-base font-black text-red-500 tracking-tighter">LL {stats.totalDebt.toLocaleString()}</p>
                      </div>
                      <div className="pl-3">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Clients</p>
                        <p className="text-base font-black text-slate-900 tracking-tighter">{customers.length}</p>
                      </div>
                    </div>
                  </div>

                  {/* Search & Add */}
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input 
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search clients..."
                        className="w-full bg-white border-2 border-slate-100 rounded-[1.2rem] pl-10 pr-10 py-2.5 focus:outline-none focus:border-emerald-500 transition-all text-xs font-bold text-slate-900 shadow-sm"
                      />
                      {searchQuery && (
                        <button 
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                    <button 
                      onClick={() => {
                        setEditingCustomer(null);
                        setCustomerForm({ name: '', phone: '', address: '' });
                        setView('add-customer');
                      }}
                      className="absolute -right-1 -top-5 bg-emerald-500 text-white p-3.5 rounded-[1.2rem] shadow-lg shadow-emerald-500/20 active:scale-90 z-10 hover:bg-emerald-600 transition-all"
                    >
                      <Plus size={20} strokeWidth={4} />
                    </button>
                  </div>

                  {/* Customer List */}
                  <div className="space-y-4 pt-4">
                    {filteredCustomers.map(customer => (
                      <motion.div
                        layout
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        key={customer.id}
                        className="bg-white p-3.5 rounded-[1.5rem] border border-slate-100 shadow-sm flex items-center justify-between active:bg-slate-50 transition-all relative group hover:shadow-md"
                      >
                        <div 
                          onClick={() => selectCustomer(customer)}
                          className="flex-1 cursor-pointer"
                        >
                          <div className="flex justify-between items-start mb-1.5">
                            <p className="font-black text-sm text-slate-900 leading-tight tracking-tight">{customer.name}</p>
                            <div className="flex items-center gap-1.5">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectCustomer(customer);
                                }}
                                className="p-2.5 bg-emerald-500 text-white rounded-lg shadow-lg shadow-emerald-500/10 active:scale-90 transition-all"
                                title="New Order"
                              >
                                <Plus size={14} strokeWidth={4} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(customer.id);
                                }}
                                className="text-red-400/20 hover:text-red-500 p-1 transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            {customer.unpaidBalance > 0 ? (
                              <div className="bg-red-500/10 text-red-500 px-3 py-1.5 rounded-lg">
                                <span className="text-[10px] font-black uppercase tracking-widest">
                                  LL {customer.unpaidBalance.toLocaleString()}
                                </span>
                              </div>
                            ) : (
                              <div className="bg-emerald-500/10 text-emerald-500 px-3 py-1.5 rounded-lg">
                                <span className="text-[10px] font-black uppercase tracking-widest">
                                  0 Clear
                                </span>
                              </div>
                            )}
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                              Last: {orders.filter(o => o.customerId === customer.id)[0]?.createdAt?.toDate().toISOString().split('T')[0] || 'NONE'}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <div className="text-center py-8 bg-white rounded-[1.5rem] border-2 border-dashed border-slate-100 flex flex-col items-center">
                        <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3 text-slate-200">
                          <Truck size={24} strokeWidth={1.5} />
                        </div>
                        <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">No clients found</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

            {view === 'stats' && (
              <div key="stats" className="space-y-4">
                <div className="flex flex-col items-center justify-center py-2">
                  <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mb-2">
                    <Truck size={32} strokeWidth={2.5} />
                  </div>
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Performance Insights</p>
                </div>
                {/* Stats Summary */}
                <div className="grid grid-cols-2 gap-3">
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-emerald-600/20 border border-emerald-500/20 p-3.5 rounded-[1.2rem] text-emerald-500 shadow-sm"
                  >
                    <p className="text-[9px] font-black opacity-80 uppercase tracking-widest mb-0.5">Total Earned</p>
                    <p className="text-base font-black tracking-tight">{formatCurrency(stats.totalEarned)}</p>
                  </motion.div>
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-red-600/20 border border-red-500/20 p-3.5 rounded-[1.2rem] text-red-500 shadow-sm"
                  >
                    <p className="text-[9px] font-black opacity-80 uppercase tracking-widest mb-0.5">Total Debt</p>
                    <p className="text-base font-black tracking-tight">{formatCurrency(stats.totalDebt)}</p>
                  </motion.div>
                </div>

                {/* Sales Chart */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-4 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-slate-200/30 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">7-Day Performance</h3>
                    <div className="flex items-center gap-1 text-emerald-500 font-black text-[9px]">
                      <ArrowUpRight size={12} />
                      <span>Live Stats</span>
                    </div>
                  </div>
                  <div className="h-40 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fill: '#94A3B8', fontWeight: 900 }} 
                        />
                        <YAxis hide />
                        <Tooltip 
                          cursor={{ fill: '#F8FAFC' }}
                          contentStyle={{ backgroundColor: '#FFFFFF', borderRadius: '15px', border: 'none', padding: '12px', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          itemStyle={{ color: '#10B981', fontSize: '12px', fontWeight: 900, padding: '0' }}
                          labelStyle={{ color: '#64748B', fontSize: '12px', fontWeight: 900, marginBottom: '4px' }}
                          formatter={(value: number) => [formatCurrency(value), 'Sales']}
                        />
                        <Bar dataKey="amount" radius={[10, 10, 0, 0]} barSize={24}>
                          {stats.chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === stats.chartData.length - 1 ? '#10B981' : '#E2E8F0'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>

                {/* Extra Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-4 rounded-[1.2rem] border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-7 h-7 bg-blue-500/10 text-blue-500 rounded-lg flex items-center justify-center">
                        <Package size={14} />
                      </div>
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Total Orders</p>
                    </div>
                    <p className="text-base font-black text-slate-900 tracking-tight">{stats.orderCount}</p>
                  </div>
                  <div className="bg-white p-4 rounded-[1.2rem] border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-7 h-7 bg-amber-500/10 text-amber-500 rounded-lg flex items-center justify-center">
                        <User size={14} />
                      </div>
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Total Clients</p>
                    </div>
                    <p className="text-base font-black text-slate-900 tracking-tight">{customers.length}</p>
                  </div>
                </div>

                {/* Debt Aging */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-5 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-slate-200/30 space-y-4"
                >
                  <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Debt Aging</h3>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">0 - 7 Days</span>
                        <span className="text-[9px] font-black text-emerald-500">{formatCurrency(stats.debtAging.recent)}</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-emerald-500 h-full" 
                          style={{ width: `${(stats.debtAging.recent / (stats.totalDebt || 1)) * 100}%` }} 
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">8 - 30 Days</span>
                        <span className="text-[9px] font-black text-amber-500">{formatCurrency(stats.debtAging.mid)}</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-amber-500 h-full" 
                          style={{ width: `${(stats.debtAging.mid / (stats.totalDebt || 1)) * 100}%` }} 
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">30+ Days</span>
                        <span className="text-[9px] font-black text-red-500">{formatCurrency(stats.debtAging.old)}</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-red-500 h-full" 
                          style={{ width: `${(stats.debtAging.old / (stats.totalDebt || 1)) * 100}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* Top Clients */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-5 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-slate-200/30 space-y-4 pb-24"
                >
                  <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Top Clients</h3>
                  <div className="space-y-3">
                    {stats.topCustomers.map((c, i) => (
                      <div 
                        key={c.id} 
                        onClick={() => {
                          const customer = customers.find(cust => cust.id === c.id);
                          if (customer) selectCustomer(customer);
                        }}
                        className="flex items-center justify-between cursor-pointer hover:bg-slate-50 p-3 rounded-[1.2rem] transition-all active:scale-[0.98] border border-transparent hover:border-slate-100"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${
                            i === 0 ? 'bg-amber-500/20 text-amber-500' : 
                            i === 1 ? 'bg-slate-500/20 text-slate-400' : 
                            i === 2 ? 'bg-orange-500/20 text-orange-500' : 
                            'bg-slate-100 text-slate-400'
                          }`}>
                            {i + 1}
                          </div>
                          <span className="font-black text-slate-900 text-base tracking-tight">{c.name}</span>
                        </div>
                        <span className="font-black text-emerald-500 text-base tracking-tight">{formatCurrency(c.totalSpent)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>
            )}

            {view === 'add-customer' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                key="add-customer" 
                className="space-y-8 p-4"
              >
                <div className="flex flex-col items-center justify-center py-4">
                  <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-[1.5rem] flex items-center justify-center mb-3 shadow-lg shadow-emerald-500/5">
                    <Truck size={32} strokeWidth={2} />
                  </div>
                  <p className="text-xs font-black text-slate-500 uppercase tracking-[0.3em]">Customer Details</p>
                </div>
                <div className="bg-white p-5 rounded-[1.5rem] border border-slate-100 shadow-xl shadow-slate-200/40 space-y-5">
                  <div className="space-y-3.5">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2.5">Full Name</label>
                      <input 
                        type="text"
                        value={customerForm.name}
                        onChange={(e) => setCustomerForm({...customerForm, name: e.target.value})}
                        placeholder="Customer Name"
                        className="w-full bg-slate-50 border-2 border-slate-50 rounded-[1rem] px-4 py-3 focus:outline-none focus:border-emerald-500/50 focus:bg-white transition-all text-sm font-black text-slate-900 placeholder:text-slate-300"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2.5">Phone Number</label>
                      <input 
                        type="tel"
                        value={customerForm.phone}
                        onChange={(e) => setCustomerForm({...customerForm, phone: e.target.value})}
                        placeholder="e.g. 70123456"
                        className="w-full bg-slate-50 border-2 border-slate-50 rounded-[1rem] px-4 py-3 focus:outline-none focus:border-emerald-500/50 focus:bg-white transition-all text-sm font-black text-slate-900 placeholder:text-slate-300"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2.5">Address</label>
                      <textarea 
                        value={customerForm.address}
                        onChange={(e) => setCustomerForm({...customerForm, address: e.target.value})}
                        placeholder="Delivery Address"
                        rows={2}
                        className="w-full bg-slate-50 border-2 border-slate-50 rounded-[1rem] px-4 py-3 focus:outline-none focus:border-emerald-500/50 focus:bg-white transition-all text-sm font-black text-slate-900 placeholder:text-slate-300"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={saveCustomer}
                    className="w-full bg-emerald-500 text-white py-4 rounded-[1.2rem] font-black text-base shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-95 flex items-center justify-center gap-3"
                  >
                    <Check size={20} strokeWidth={3} />
                    {editingCustomer ? 'Update Customer' : 'Save Customer'}
                  </button>
                </div>
              </motion.div>
            )}

            {view === 'customer-profile' && selectedCustomer && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                key="customer-profile" 
                className="space-y-6 p-4"
              >
                <div className="flex flex-col items-center justify-center py-4">
                  <div className="w-16 h-16 bg-slate-100 text-slate-300 rounded-full flex items-center justify-center mb-2">
                    <Truck size={32} strokeWidth={2} />
                  </div>
                  <p className="text-sm font-black text-slate-400 uppercase tracking-[0.3em]">Client Profile</p>
                </div>
                {/* Profile Header */}
                <div className="bg-white p-5 rounded-[1.5rem] border border-slate-100 shadow-xl shadow-slate-200/40 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 bg-emerald-500 rounded-[1.2rem] flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                      <User size={28} strokeWidth={2.5} />
                    </div>
                    <div className="flex-1">
                      <h2 className="text-lg font-black text-slate-900 leading-tight tracking-tight">{selectedCustomer.name}</h2>
                      <div className="flex flex-col gap-0.5 mt-1.5">
                        {selectedCustomer.phone && (
                          <a href={`tel:${selectedCustomer.phone}`} className="text-[10px] font-black text-emerald-500 flex items-center gap-1.5">
                            <Phone size={12} /> {selectedCustomer.phone}
                          </a>
                        )}
                        {selectedCustomer.address && (
                          <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
                            <MapPin size={12} /> {selectedCustomer.address}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-50">
                    <div className="bg-slate-50 p-5 rounded-[2rem]">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Spent</p>
                      <p className="text-xl font-black text-slate-900">{formatCurrency(stats.customerStats?.totalSpent || 0)}</p>
                    </div>
                    <div className="bg-slate-50 p-5 rounded-[2rem]">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Orders</p>
                      <p className="text-xl font-black text-slate-900">{stats.customerStats?.orderCount || 0}</p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    {stats.customerStats?.totalSpent && stats.customerStats.totalSpent > 0 && (
                      <button 
                        onClick={() => setConfirmMarkPaid(true)}
                        className="flex-1 bg-slate-100 text-slate-500 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
                      >
                        Clear Debt
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Categories */}
                <div className="bg-white p-6 rounded-[3rem] border border-slate-100 shadow-xl shadow-slate-200/30 space-y-6">
                  <div className="flex items-center justify-between px-4">
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Quick Categories</h3>
                    <span className="text-xs font-black text-emerald-500 bg-emerald-50 px-4 py-2 rounded-2xl">SELECT SHOP</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2.5">
                    {[
                      { name: 'Supermarket', icon: <Store size={18} />, color: 'bg-blue-500' },
                      { name: 'Pharmacy', icon: <Plus size={18} />, color: 'bg-red-500' },
                      { name: 'Bakery', icon: <Package size={18} />, color: 'bg-amber-500' },
                      { name: 'Butcher', icon: <Package size={18} />, color: 'bg-rose-500' },
                      { name: 'Roastery', icon: <Package size={18} />, color: 'bg-orange-500' },
                      { name: 'Vegetables', icon: <Package size={18} />, color: 'bg-emerald-500' },
                      { name: 'Restaurant', icon: <Store size={18} />, color: 'bg-indigo-500' },
                      { name: 'Other', icon: <MoreVertical size={18} />, color: 'bg-slate-500' }
                    ].map((cat) => (
                      <button
                        key={cat.name}
                        onClick={() => setShopName(cat.name)}
                        className={`flex flex-col items-center justify-center p-3 rounded-[1.2rem] border-2 transition-all active:scale-90 ${
                          shopName === cat.name 
                            ? `${cat.color} border-transparent text-white shadow-xl shadow-${cat.color.split('-')[1]}-500/40` 
                            : 'bg-slate-50 border-slate-50 text-slate-500 hover:border-emerald-100'
                        }`}
                      >
                        {cat.icon}
                        <span className="text-[8px] font-black mt-1.5 uppercase tracking-tighter">{cat.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Add Item Form */}
                <div className="bg-white p-4 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-slate-200/30 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2.5">Shop Name</label>
                      <div className="relative">
                        <input 
                          type="text"
                          value={shopName}
                          onChange={(e) => setShopName(e.target.value)}
                          placeholder="e.g. Supermarket"
                          className="w-full bg-slate-50 border-2 border-slate-50 rounded-[1rem] pl-3.5 pr-10 py-3 text-sm font-black text-slate-900 focus:outline-none focus:border-emerald-500/50 transition-all"
                        />
                        <button 
                          onClick={startVoiceCapture}
                          className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-emerald-500'}`}
                        >
                          <Mic size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2.5">Price (L.L.)</label>
                      <input 
                        type="number"
                        inputMode="numeric"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-50 border-2 border-slate-50 rounded-[1rem] px-3.5 py-3 text-sm font-black text-slate-900 focus:outline-none focus:border-emerald-500/50 transition-all"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={addItemToOrder}
                    disabled={!shopName || !price}
                    className="w-full bg-slate-900 text-white py-3 rounded-[1rem] font-black text-sm shadow-lg shadow-slate-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-30 disabled:active:scale-100"
                  >
                    <Plus size={18} strokeWidth={3} />
                    Add to Bill
                  </button>
                </div>

                {/* Delivery Fee */}
                <div className="bg-white p-4 rounded-[1.2rem] border border-slate-100 shadow-lg shadow-slate-200/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-500/10 text-emerald-500 rounded-lg flex items-center justify-center">
                        <Calculator size={20} />
                      </div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Delivery Fee</label>
                    </div>
                    <div className="relative w-32">
                      <input 
                        type="number"
                        inputMode="numeric"
                        value={deliveryFee}
                        onChange={(e) => setDeliveryFee(e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-50 border-2 border-slate-50 rounded-lg pl-3 pr-10 py-3 text-base font-black text-slate-900 text-right focus:outline-none focus:border-emerald-500/50 transition-all"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">LL</span>
                    </div>
                  </div>
                </div>

                {/* Current Order Items */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-3">
                    <div className="flex items-center gap-2.5">
                      <ReceiptText size={22} className="text-emerald-500" />
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Items Detail</h3>
                    </div>
                    {currentItems.length > 0 && (
                      <button 
                        onClick={() => setCurrentItems([])}
                        className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-1.5 hover:bg-red-50 px-3 py-1.5 rounded-xl transition-colors"
                      >
                        <RotateCcw size={14} /> Clear All
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {currentItems.map((item, index) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={index}
                        className="bg-white p-4 rounded-[1.2rem] border border-slate-100 flex items-center justify-between shadow-sm"
                      >
                        <div>
                          <p className="font-black text-base text-slate-900 tracking-tight">{item.shop}</p>
                          <p className="text-emerald-500 font-black text-sm">{formatCurrency(item.price)}</p>
                        </div>
                        <button 
                          onClick={() => removeItemFromOrder(index)}
                          className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-90"
                        >
                          <Trash2 size={20} />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                  {currentItems.length === 0 && (
                    <div className="text-center py-8 bg-white rounded-[1.5rem] border-2 border-dashed border-slate-100">
                      <p className="text-slate-300 font-black text-xs uppercase tracking-widest">No items added yet</p>
                    </div>
                  )}
                </div>

                {currentItems.length > 0 && (
                  <button 
                    onClick={submitOrder}
                    className="w-full bg-emerald-500 text-white py-3.5 rounded-[1.2rem] font-black text-sm shadow-xl shadow-emerald-500/30 hover:bg-emerald-600 transition-all active:scale-95 flex items-center justify-center gap-2.5"
                  >
                    <CheckCircle2 size={20} strokeWidth={2.5} />
                    Complete Order
                  </button>
                )}

                <div className="pb-24">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-3 mb-4">Recent Activity</h3>
                  <div className="space-y-3">
                    {orders.filter(o => o.customerId === selectedCustomer.id).slice(0, 5).map(order => (
                      <div key={order.id} className="bg-white p-4 rounded-[1.2rem] border border-slate-50 shadow-sm flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
                            {order.createdAt?.toDate().toLocaleDateString('en-LB', { month: 'short', day: 'numeric' })}
                          </p>
                          <p className="font-black text-base text-slate-900 tracking-tight">{formatCurrency(order.total)}</p>
                        </div>
                        <div className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                          order.status === 'paid' ? 'bg-emerald-500/10 text-emerald-500' : 
                          order.status === 'delivered' ? 'bg-blue-500/10 text-blue-500' : 
                          'bg-amber-500/10 text-amber-500'
                        }`}>
                          {order.status}
                        </div>
                      </div>
                    ))}
                    {orders.filter(o => o.customerId === selectedCustomer.id).length === 0 && (
                      <p className="text-center py-4 text-slate-300 font-black italic text-[10px] uppercase tracking-widest">No orders yet</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Combined View handled in customer-profile */}

            {view === 'history' && (
              <div key="history" className="space-y-8">
                <div className="flex flex-col items-center justify-center py-4">
                  <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-[1.5rem] flex items-center justify-center mb-3">
                    <Truck size={32} strokeWidth={2} />
                  </div>
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Past Deliveries</p>
                </div>
                <div className="space-y-6">
                  <div className="flex items-center justify-between px-2.5">
                    <div className="flex items-center gap-3">
                      <History size={20} className="text-emerald-500" />
                      <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Order History</h3>
                    </div>
                    <button 
                      onClick={() => {
                        if (selectedCustomer) {
                          setView('customer-profile');
                        } else {
                          setView('home');
                        }
                      }}
                      className="bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
                    >
                      + New
                    </button>
                  </div>

                  {/* History Search & Filter */}
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="text"
                        value={historySearchQuery}
                        onChange={(e) => setHistorySearchQuery(e.target.value)}
                        placeholder="Search orders..."
                        className="w-full bg-white border-2 border-slate-100 rounded-[1.2rem] pl-11 pr-5 py-3.5 focus:outline-none focus:border-emerald-500 transition-all text-sm font-black text-slate-900 shadow-lg shadow-slate-200/10"
                      />
                    </div>
                    <select 
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as any)}
                      className="bg-white border-2 border-slate-100 rounded-[1.2rem] px-4 py-3.5 text-xs font-black text-slate-500 focus:outline-none shadow-lg shadow-slate-200/10 uppercase tracking-widest"
                    >
                      <option value="all">All</option>
                      <option value="pending">Pending</option>
                      <option value="delivered">Delivered</option>
                      <option value="paid">Paid</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-6 pb-24">
                  {filteredOrders.map(order => (
                    <motion.div 
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      key={order.id} 
                      className="bg-white p-3.5 rounded-[1.5rem] border border-slate-100 shadow-xl shadow-slate-200/30 space-y-3.5 group"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3.5">
                          <div className={`p-2.5 rounded-lg ${
                            order.status === 'paid' ? 'bg-emerald-500/10 text-emerald-500' : 
                            order.status === 'delivered' ? 'bg-blue-500/10 text-blue-500' : 
                            'bg-amber-500/10 text-amber-500'
                          }`}>
                            {order.status === 'paid' ? <CheckCircle size={18} /> : 
                             order.status === 'delivered' ? <Package size={18} /> : 
                             <Clock size={18} />}
                          </div>
                          <div>
                            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest flex items-center gap-1.5 mb-0.5">
                              {order.createdAt?.toDate().toLocaleDateString('en-LB', { month: 'short', day: 'numeric', year: 'numeric' })}
                              <span className="w-1 h-1 bg-slate-200 rounded-full" />
                              {order.customerName}
                            </p>
                            <p className="text-lg font-black text-slate-900 tracking-tighter">{formatCurrency(order.total)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button 
                            onClick={() => shareToWhatsApp(order)}
                            className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all active:scale-90"
                            title="Share to WhatsApp"
                          >
                            <MessageCircle size={18} />
                          </button>
                          <button 
                            onClick={() => copyToClipboard(order)}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-all active:scale-90"
                            title="Copy to Clipboard"
                          >
                            <Copy size={18} />
                          </button>
                          <button 
                            onClick={() => setConfirmDeleteOrderId(order.id)}
                            className="p-1.5 text-slate-300 hover:text-red-500 transition-colors active:scale-90"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                      
                      <div className="bg-slate-50 p-3.5 rounded-[1.2rem] space-y-2.5">
                        <div className="flex justify-between items-center pb-1.5 border-b border-slate-200/50">
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                            <Clock size={10} /> {order.createdAt?.toDate().toLocaleString('en-LB', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">ID: {order.id.slice(-4)}</span>
                        </div>
                        {order.items.map((item, i) => (
                          <div key={i} className="flex justify-between text-[11px] items-center">
                            <span className="text-slate-500 font-black">{item.shop}</span>
                            <span className="font-black text-slate-900">{formatCurrency(item.price)}</span>
                          </div>
                        ))}
                        <div className="pt-1.5 border-t border-slate-200/50 flex justify-between text-[11px] items-center">
                          <span className="text-slate-400 font-black uppercase text-[8px] tracking-widest">Delivery Fee</span>
                          <span className="font-black text-emerald-500">{formatCurrency(order.deliveryFee)}</span>
                        </div>
                      </div>

                      {/* Status Update Actions */}
                      <div className="flex gap-3 pt-2">
                        {order.status === 'pending' && (
                          <button 
                            onClick={() => updateOrderStatus(order.id, 'delivered')}
                            className="flex-1 bg-blue-500 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-500/20"
                          >
                            <Package size={18} />
                            Mark Delivered
                          </button>
                        )}
                        {order.status === 'delivered' && (
                          <button 
                            onClick={() => updateOrderStatus(order.id, 'paid')}
                            className="flex-1 bg-emerald-500 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20"
                          >
                            <CreditCard size={18} />
                            Mark Paid
                          </button>
                        )}
                        {order.status === 'paid' && (
                          <div className="flex-1 bg-emerald-500/10 text-emerald-500 py-4 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 border-2 border-emerald-500/20">
                            <CheckCircle size={18} />
                            Payment Received
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                    {filteredOrders.length === 0 && (
                      <div className="text-center py-8 bg-white rounded-[1.5rem] border-2 border-dashed border-slate-100 flex flex-col items-center">
                        <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3 text-slate-200">
                          <Truck size={24} strokeWidth={1.5} />
                        </div>
                        <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">No orders found</p>
                      </div>
                    )}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

        {/* Bottom Nav */}
        {user && (
          <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-3 py-0.5 flex justify-around items-center z-30 shadow-lg">
            <button 
              onClick={() => {
                saveCurrentToDraft(selectedCustomer?.id);
                setView('home');
              }}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1 rounded-lg transition-all ${view === 'home' ? 'text-emerald-500' : 'text-slate-400'}`}
            >
              <User size={18} strokeWidth={view === 'home' ? 3 : 2} />
              <span className="text-[8px] font-bold uppercase tracking-widest">Clients</span>
              {view === 'home' && <div className="w-1 h-1 bg-emerald-500 rounded-full" />}
            </button>
            <button 
              onClick={() => {
                saveCurrentToDraft(selectedCustomer?.id);
                setView('stats');
              }}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1 rounded-lg transition-all ${view === 'stats' ? 'text-emerald-500' : 'text-slate-400'}`}
            >
              <TrendingUp size={18} strokeWidth={view === 'stats' ? 3 : 2} />
              <span className="text-[8px] font-bold uppercase tracking-widest">Stats</span>
              {view === 'stats' && <div className="w-1 h-1 bg-emerald-500 rounded-full" />}
            </button>
            <button 
              onClick={() => {
                saveCurrentToDraft(selectedCustomer?.id);
                setView('history');
              }}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1 rounded-lg transition-all ${view === 'history' ? 'text-emerald-500' : 'text-slate-400'}`}
            >
              <History size={18} strokeWidth={view === 'history' ? 3 : 2} />
              <span className="text-[8px] font-bold uppercase tracking-widest">History</span>
              {view === 'history' && <div className="w-1 h-1 bg-emerald-500 rounded-full" />}
            </button>
          </nav>
        )}

        {/* Delete Confirmation Modal */}
        {confirmDeleteId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div 
              onClick={() => setConfirmDeleteId(null)}
              className="absolute inset-0 bg-black/80"
            />
            <div className="bg-white w-full max-w-sm rounded-2xl p-6 relative z-10 shadow-2xl border border-slate-200">
              <div className="bg-red-500/10 w-14 h-14 rounded-xl flex items-center justify-center text-red-500 mb-5">
                <Trash2 size={28} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-1.5">Delete Client?</h3>
              <p className="text-slate-500 mb-6 leading-relaxed text-sm">
                Are you sure you want to remove this client? Their order history will remain, but the client record will be gone.
              </p>
              <div className="flex gap-2.5">
                <button 
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-lg font-bold uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => deleteCustomer(confirmDeleteId)}
                  className="flex-1 bg-red-500 text-white py-3 rounded-lg font-bold uppercase tracking-widest text-[10px] shadow-sm hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDeleteOrderId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div 
              onClick={() => setConfirmDeleteOrderId(null)}
              className="absolute inset-0 bg-black/80"
            />
            <div className="bg-white w-full max-w-sm rounded-2xl p-6 relative z-10 shadow-2xl border border-slate-200">
              <div className="bg-red-500/10 w-14 h-14 rounded-xl flex items-center justify-center text-red-500 mb-5">
                <Trash2 size={28} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-1.5">Delete Order?</h3>
              <p className="text-slate-500 mb-6 leading-relaxed text-sm">
                Are you sure you want to delete this order? This action cannot be undone.
              </p>
              <div className="flex gap-2.5">
                <button 
                  onClick={() => setConfirmDeleteOrderId(null)}
                  className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-lg font-bold uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => deleteOrder(confirmDeleteOrderId)}
                  className="flex-1 bg-red-500 text-white py-3 rounded-lg font-bold uppercase tracking-widest text-[10px] shadow-sm hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmMarkPaid && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div 
              onClick={() => setConfirmMarkPaid(false)}
              className="absolute inset-0 bg-black/80"
            />
            <div className="bg-white w-full max-w-sm rounded-2xl p-6 relative z-10 shadow-2xl border border-slate-200">
              <div className="bg-emerald-500/10 w-14 h-14 rounded-xl flex items-center justify-center text-emerald-500 mb-5">
                <CheckCircle size={28} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-1.5">Clear All Debt?</h3>
              <p className="text-slate-500 mb-6 leading-relaxed text-sm">
                Mark all outstanding orders for <strong>{selectedCustomer?.name}</strong> as paid?
              </p>
              <div className="flex gap-2.5">
                <button 
                  onClick={() => setConfirmMarkPaid(false)}
                  className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-lg font-bold uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={markAllAsPaid}
                  className="flex-1 bg-emerald-500 text-white py-3 rounded-lg font-bold uppercase tracking-widest text-[10px] shadow-sm hover:bg-emerald-600 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
