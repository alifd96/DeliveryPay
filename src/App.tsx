/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  Trash2, 
  Calculator, 
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
  MessageCircle,
  TrendingUp,
  Package,
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
import { motion, AnimatePresence } from 'motion/react';
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
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [isListening, setIsListening] = useState(false);

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
    if (!user || !selectedCustomer) return;

    const q = query(
      collection(db, 'orders'),
      where('customerId', '==', selectedCustomer.id),
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
  }, [user, selectedCustomer]);

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
      setCurrentItems([]);
      setDeliveryFee('0');
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
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full shadow-lg"
        />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-24">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {view !== 'home' && (
              <button 
                onClick={() => {
                  setEditingCustomer(null);
                  setSelectedCustomer(null);
                  setView('home');
                }}
                className="p-3 hover:bg-slate-100 rounded-2xl transition-all active:scale-90"
              >
                <ArrowLeft size={22} className="text-slate-600" />
              </button>
            )}
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">
                {view === 'home' ? 'Clients' : 
                 view === 'stats' ? 'Statistics' :
                 view === 'add-customer' ? (editingCustomer ? 'Edit Client' : 'New Client') : 
                 view === 'customer-profile' ? 'Client Profile' :
                 selectedCustomer?.name}
              </h1>
              {view === 'home' && <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Welcome back</p>}
            </div>
          </div>
          <div className="w-10 h-10" />
        </header>

        <main className="max-w-xl mx-auto p-6">
          <AnimatePresence mode="wait">
            {view === 'home' && (
              <motion.div 
                key="home"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="space-y-6"
              >
                {/* Summary Card */}
                <div className="bg-slate-900 rounded-[2.5rem] p-6 text-white shadow-2xl shadow-slate-200 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 rounded-full -mr-16 -mt-16 blur-2xl" />
                  <div className="relative z-10 flex justify-between items-end">
                    <div>
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-1">Total Outstanding</p>
                      <p className="text-3xl font-black">{formatCurrency(stats.totalDebt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Total Clients</p>
                      <p className="text-xl font-black">{customers.length}</p>
                    </div>
                  </div>
                </div>

                {/* Search & Add */}
                <div className="flex gap-3">
                  <div className="relative flex-1 group">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={22} />
                    <input 
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search clients..."
                      className="w-full bg-white border border-slate-100 rounded-[1.5rem] pl-14 pr-12 py-4 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 shadow-sm transition-all text-lg"
                    />
                    {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery('')}
                        className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-slate-500"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                  <button 
                    onClick={() => {
                      setEditingCustomer(null);
                      setCustomerForm({ name: '', phone: '', address: '' });
                      setView('add-customer');
                    }}
                    className="bg-gradient-to-br from-emerald-400 to-emerald-600 text-white p-4 rounded-[1.5rem] shadow-lg shadow-emerald-200 hover:shadow-emerald-300 transition-all active:scale-95"
                  >
                    <Plus size={28} strokeWidth={3} />
                  </button>
                </div>

                {/* Customer List */}
                <div className="space-y-4">
                  {filteredCustomers.map(customer => (
                    <motion.div
                      key={customer.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="group relative bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between hover:border-emerald-200 hover:shadow-md transition-all overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div 
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setView('customer');
                        }}
                        className="flex items-center gap-5 flex-1 cursor-pointer"
                      >
                        <div className="w-14 h-14 bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 group-hover:from-emerald-500 group-hover:to-emerald-600 group-hover:text-white transition-all shadow-inner">
                          <User size={28} />
                        </div>
                        <div className="text-left">
                          <p className="font-black text-xl text-slate-800 tracking-tight">{customer.name}</p>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3 text-slate-400">
                              {customer.unpaidBalance > 0 ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-1">
                                    <Wallet size={10} /> Debt: {formatCurrency(customer.unpaidBalance)}
                                  </span>
                                  {customer.oldestDebtDays > 0 && (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${customer.oldestDebtDays > 7 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>
                                      {customer.oldestDebtDays}d old
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                                  <CheckCircle2 size={10} /> Clear
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] text-slate-300 font-medium flex items-center gap-1">
                              <Clock size={8} /> Added: {customer.createdAt?.toDate().toLocaleString('en-LB', { dateStyle: 'short', timeStyle: 'short' })}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {customer.phone && (
                          <a 
                            href={`tel:${customer.phone}`}
                            className="p-2.5 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-xl transition-all"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone size={16} />
                          </a>
                        )}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCustomer(customer);
                            setView('customer-profile');
                          }}
                          className="p-2.5 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-xl transition-all"
                          title="Profile"
                        >
                          <ChevronRight size={18} />
                        </button>
                        <div className="w-px h-6 bg-slate-100 mx-1" />
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCustomer(customer);
                            setCustomerForm({ name: customer.name, phone: customer.phone || '', address: customer.address || '' });
                            setView('add-customer');
                          }}
                          className="p-2.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all"
                        >
                          <Edit3 size={16} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(customer.id);
                          }}
                          className="p-2.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                  {filteredCustomers.length === 0 && (
                    <div className="text-center py-20 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
                      <User size={48} className="mx-auto text-slate-200 mb-4" />
                      <p className="text-slate-400 font-bold mb-6">No clients found</p>
                      <button 
                        onClick={() => setView('add-customer')}
                        className="bg-emerald-500 text-white px-8 py-3 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-emerald-200"
                      >
                        Add First Client
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {view === 'stats' && (
              <motion.div 
                key="stats"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="space-y-8"
              >
                {/* Stats Summary */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 rounded-[2rem] text-white shadow-lg shadow-emerald-200 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-150" />
                    <div className="bg-white/20 w-10 h-10 rounded-xl flex items-center justify-center mb-3 relative z-10">
                      <TrendingUp size={20} />
                    </div>
                    <p className="text-xs font-black text-emerald-100 uppercase tracking-wider relative z-10 opacity-80">Total Sales</p>
                    <p className="text-xl font-black relative z-10">{formatCurrency(stats.totalEarned)}</p>
                  </div>
                  <div className="bg-gradient-to-br from-red-500 to-red-600 p-6 rounded-[2rem] text-white shadow-lg shadow-red-200 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-150" />
                    <div className="bg-white/20 w-10 h-10 rounded-xl flex items-center justify-center mb-3 relative z-10">
                      <Wallet size={20} />
                    </div>
                    <p className="text-xs font-black text-red-100 uppercase tracking-wider relative z-10 opacity-80">Total Debt</p>
                    <p className="text-xl font-black relative z-10">{formatCurrency(stats.totalDebt)}</p>
                  </div>
                </div>

                {/* Sales Chart */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">7-Day Performance</h3>
                    <div className="flex items-center gap-1 text-emerald-600 font-bold text-xs">
                      <ArrowUpRight size={14} />
                      <span>Live Stats</span>
                    </div>
                  </div>
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fontWeight: 700, fill: '#94A3B8' }} 
                        />
                        <YAxis hide />
                        <Tooltip 
                          cursor={{ fill: '#F8FAFC' }}
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800 }}
                          formatter={(value: number) => [formatCurrency(value), 'Sales']}
                        />
                        <Bar dataKey="amount" radius={[6, 6, 6, 6]} barSize={24}>
                          {stats.chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === stats.chartData.length - 1 ? '#10B981' : '#E2E8F0'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Extra Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
                        <Package size={16} />
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Orders</p>
                    </div>
                    <p className="text-2xl font-black text-slate-900">{stats.orderCount}</p>
                  </div>
                  <div className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center">
                        <User size={16} />
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Clients</p>
                    </div>
                    <p className="text-2xl font-black text-slate-900">{customers.length}</p>
                  </div>
                </div>

                {/* Debt Aging */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1">Debt Aging</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500">0 - 7 Days</span>
                      <span className="text-xs font-black text-emerald-600">{formatCurrency(stats.debtAging.recent)}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-emerald-500 h-full transition-all duration-1000" 
                        style={{ width: `${(stats.debtAging.recent / (stats.totalDebt || 1)) * 100}%` }} 
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500">8 - 30 Days</span>
                      <span className="text-xs font-black text-amber-600">{formatCurrency(stats.debtAging.mid)}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-amber-500 h-full transition-all duration-1000" 
                        style={{ width: `${(stats.debtAging.mid / (stats.totalDebt || 1)) * 100}%` }} 
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500">30+ Days</span>
                      <span className="text-xs font-black text-red-600">{formatCurrency(stats.debtAging.old)}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-red-500 h-full transition-all duration-1000" 
                        style={{ width: `${(stats.debtAging.old / (stats.totalDebt || 1)) * 100}%` }} 
                      />
                    </div>
                  </div>
                </div>

                {/* Top Clients */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1">Top Clients</h3>
                  <div className="space-y-4">
                    {stats.topCustomers.map((c, i) => (
                      <div key={c.id} className="flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs ${
                            i === 0 ? 'bg-amber-100 text-amber-600' : 
                            i === 1 ? 'bg-slate-100 text-slate-600' : 
                            i === 2 ? 'bg-orange-100 text-orange-600' : 
                            'bg-slate-50 text-slate-400'
                          }`}>
                            {i + 1}
                          </div>
                          <span className="font-bold text-slate-700">{c.name}</span>
                        </div>
                        <span className="font-black text-slate-900">{formatCurrency(c.totalSpent)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'add-customer' && (
              <motion.div 
                key="add-customer"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                      <input 
                        type="text"
                        value={customerForm.name}
                        onChange={(e) => setCustomerForm({...customerForm, name: e.target.value})}
                        placeholder="Customer Name"
                        className="w-full bg-slate-50 border-none rounded-2xl px-6 py-4 focus:ring-4 focus:ring-emerald-500/10 text-lg font-medium"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number</label>
                      <input 
                        type="tel"
                        value={customerForm.phone}
                        onChange={(e) => setCustomerForm({...customerForm, phone: e.target.value})}
                        placeholder="e.g. 70123456"
                        className="w-full bg-slate-50 border-none rounded-2xl px-6 py-4 focus:ring-4 focus:ring-emerald-500/10 text-lg font-medium"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Address</label>
                      <textarea 
                        value={customerForm.address}
                        onChange={(e) => setCustomerForm({...customerForm, address: e.target.value})}
                        placeholder="Delivery Address"
                        rows={3}
                        className="w-full bg-slate-50 border-none rounded-2xl px-6 py-4 focus:ring-4 focus:ring-emerald-500/10 text-lg font-medium"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={saveCustomer}
                    className="w-full bg-emerald-500 text-white py-5 rounded-2xl font-black text-xl shadow-xl shadow-emerald-200 hover:bg-emerald-600 transition-all active:scale-95 flex items-center justify-center gap-3"
                  >
                    <Check size={28} />
                    {editingCustomer ? 'Update Customer' : 'Save Customer'}
                  </button>
                </div>
              </motion.div>
            )}

            {view === 'customer-profile' && selectedCustomer && (
              <motion.div
                key="customer-profile"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Profile Header */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
                      <User size={40} />
                    </div>
                    <div>
                      <h2 className="text-3xl font-black text-slate-900">{selectedCustomer.name}</h2>
                      <div className="flex flex-col gap-1 mt-1">
                        {selectedCustomer.phone && (
                          <a href={`tel:${selectedCustomer.phone}`} className="text-sm font-bold text-emerald-600 flex items-center gap-2">
                            <Phone size={14} /> {selectedCustomer.phone}
                          </a>
                        )}
                        {selectedCustomer.address && (
                          <p className="text-sm font-medium text-slate-400 flex items-center gap-2">
                            <MapPin size={14} /> {selectedCustomer.address}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50">
                    <div className="bg-slate-50 p-4 rounded-2xl">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Spent</p>
                      <p className="text-lg font-black text-slate-900">{formatCurrency(stats.customerStats?.totalSpent || 0)}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Orders</p>
                      <p className="text-lg font-black text-slate-900">{stats.customerStats?.orderCount || 0}</p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={() => setView('customer')}
                      className="flex-1 bg-emerald-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-emerald-200 hover:bg-emerald-600 transition-all active:scale-95 flex items-center justify-center gap-3"
                    >
                      <Plus size={24} strokeWidth={3} />
                      New Order
                    </button>
                    {stats.customerStats?.totalSpent && stats.customerStats.totalSpent > 0 && (
                      <button 
                        onClick={() => setConfirmMarkPaid(true)}
                        className="bg-slate-900 text-white px-6 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all active:scale-95"
                      >
                        Clear Debt
                      </button>
                    )}
                  </div>
                </div>

                {/* Recent Orders for this customer */}
                <div className="space-y-4">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1">Recent Activity</h3>
                  {orders.filter(o => o.customerId === selectedCustomer.id).slice(0, 5).map(order => (
                    <div key={order.id} className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase">
                          {order.createdAt?.toDate().toLocaleDateString('en-LB', { month: 'short', day: 'numeric' })}
                        </p>
                        <p className="font-black text-lg text-slate-900">{formatCurrency(order.total)}</p>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        order.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : 
                        order.status === 'delivered' ? 'bg-blue-50 text-blue-600' : 
                        'bg-amber-50 text-amber-600'
                      }`}>
                        {order.status}
                      </div>
                    </div>
                  ))}
                  {orders.filter(o => o.customerId === selectedCustomer.id).length === 0 && (
                    <p className="text-center py-8 text-slate-400 font-bold italic">No orders yet</p>
                  )}
                </div>
              </motion.div>
            )}

            {view === 'customer' && (
              <motion.div 
                key="customer"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-8"
              >
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-8 rounded-[2.5rem] text-white shadow-2xl shadow-emerald-200 relative overflow-hidden">
                  <div className="absolute top-[-20%] right-[-10%] w-40 h-40 bg-white/10 rounded-full blur-2xl" />
                  <p className="text-emerald-100 text-sm font-black uppercase tracking-[0.2em] mb-2 opacity-80">Current Total</p>
                  <h2 className="text-5xl font-black tracking-tighter">{formatCurrency(currentTotal)}</h2>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/50 space-y-6">
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Shop / Mahal</label>
                      <div className="relative flex gap-2">
                        <div className="relative flex-1">
                          <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                          <input 
                            type="text"
                            value={shopName}
                            onChange={(e) => setShopName(e.target.value)}
                            placeholder="e.g. Supermarket"
                            className="w-full bg-slate-50 border-none rounded-2xl pl-12 pr-6 py-4 focus:ring-4 focus:ring-emerald-500/10 text-lg font-medium"
                          />
                        </div>
                        <button 
                          onClick={startVoiceCapture}
                          className={`p-4 rounded-2xl transition-all shadow-sm ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white text-slate-400 hover:text-emerald-500 border border-slate-100'}`}
                        >
                          {isListening ? <Volume2 size={24} /> : <Mic size={24} />}
                        </button>
                      </div>
                      {voiceError && (
                        <div className="flex items-center gap-2 text-red-500 text-[10px] font-black uppercase tracking-widest mt-2 bg-red-50 p-3 rounded-xl">
                          <AlertCircle size={14} />
                          {voiceError}
                          <button onClick={() => setVoiceError(null)} className="ml-auto hover:scale-110 transition-transform">
                            <X size={14} />
                          </button>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {['Supermarket', 'Pharmacy', 'Bakery', 'Butcher', 'Roastery'].map(shop => (
                          <button
                            key={shop}
                            onClick={() => setShopName(shop)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-emerald-100 hover:text-emerald-600 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
                          >
                            {shop}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Price (L.L.)</label>
                        <input 
                          type="number"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          placeholder="0"
                          className="w-full bg-slate-50 border-none rounded-2xl px-6 py-4 focus:ring-4 focus:ring-emerald-500/10 text-lg font-medium"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Delivery Fee</label>
                        <input 
                          type="number"
                          value={deliveryFee}
                          onChange={(e) => setDeliveryFee(e.target.value)}
                          placeholder="0"
                          className="w-full bg-slate-50 border-none rounded-2xl px-6 py-4 focus:ring-4 focus:ring-emerald-500/10 text-lg font-medium"
                        />
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={addItemToOrder}
                    className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black text-lg hover:bg-black transition-all active:scale-95 flex items-center justify-center gap-3 shadow-lg"
                  >
                    <Plus size={24} strokeWidth={3} />
                    Add to List
                  </button>
                </div>

                {/* Current Order Items */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between ml-1">
                    <div className="flex items-center gap-2">
                      <ReceiptText size={18} className="text-emerald-500" />
                      <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Items Detail</h3>
                    </div>
                    {currentItems.length > 0 && (
                      <button 
                        onClick={() => setCurrentItems([])}
                        className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-1 hover:bg-red-50 px-2 py-1 rounded-lg transition-all"
                      >
                        <RotateCcw size={12} /> Clear All
                      </button>
                    )}
                  </div>
                  <AnimatePresence>
                    {currentItems.map((item, index) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        key={index}
                        className="bg-white p-5 rounded-[1.5rem] border border-slate-100 flex items-center justify-between shadow-sm"
                      >
                        <div>
                          <p className="font-black text-lg text-slate-800">{item.shop}</p>
                          <p className="text-emerald-600 font-bold">{formatCurrency(item.price)}</p>
                        </div>
                        <button 
                          onClick={() => removeItemFromOrder(index)}
                          className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        >
                          <Trash2 size={20} />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {currentItems.length === 0 && (
                    <div className="text-center py-12 bg-slate-100/50 rounded-[2rem] border-2 border-dashed border-slate-200">
                      <p className="text-slate-400 font-bold">No items added yet</p>
                    </div>
                  )}
                </div>

                {currentItems.length > 0 && (
                  <button 
                    onClick={submitOrder}
                    className="w-full bg-emerald-500 text-white py-5 rounded-[2rem] font-black text-xl shadow-xl shadow-emerald-200 hover:bg-emerald-600 transition-all active:scale-95 flex items-center justify-center gap-3"
                  >
                    <CheckCircle2 size={28} />
                    Complete Order
                  </button>
                )}
              </motion.div>
            )}

            {view === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <History size={20} className="text-emerald-500" />
                      <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Order History</h3>
                    </div>
                    <button 
                      onClick={() => setView('customer')}
                      className="bg-emerald-100 text-emerald-600 px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider hover:bg-emerald-200 transition-all"
                    >
                      + New
                    </button>
                  </div>

                  {/* History Search & Filter */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="text"
                        value={historySearchQuery}
                        onChange={(e) => setHistorySearchQuery(e.target.value)}
                        placeholder="Search orders..."
                        className="w-full bg-white border border-slate-100 rounded-2xl pl-11 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm text-sm"
                      />
                    </div>
                    <select 
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as any)}
                      className="bg-white border border-slate-100 rounded-2xl px-4 py-3 text-xs font-bold text-slate-600 focus:outline-none shadow-sm"
                    >
                      <option value="all">All Status</option>
                      <option value="pending">Pending</option>
                      <option value="delivered">Delivered</option>
                      <option value="paid">Paid</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-6">
                  {filteredOrders.map(order => (
                    <div key={order.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 space-y-5 group">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className={`p-3 rounded-xl ${
                            order.status === 'paid' ? 'bg-emerald-50 text-emerald-500' : 
                            order.status === 'delivered' ? 'bg-blue-50 text-blue-500' : 
                            'bg-amber-50 text-amber-500'
                          }`}>
                            {order.status === 'paid' ? <CheckCircle size={20} /> : 
                             order.status === 'delivered' ? <Package size={20} /> : 
                             <Clock size={20} />}
                          </div>
                          <div>
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-tighter flex items-center gap-2">
                              {order.createdAt?.toDate().toLocaleDateString('en-LB', { month: 'short', day: 'numeric', year: 'numeric' })}
                              <span className="w-1 h-1 bg-slate-300 rounded-full" />
                              {order.customerName}
                            </p>
                            <p className="text-3xl font-black text-slate-900 tracking-tighter">{formatCurrency(order.total)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => shareToWhatsApp(order)}
                            className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-xl transition-all"
                            title="Share to WhatsApp"
                          >
                            <MessageCircle size={18} />
                          </button>
                          <button 
                            onClick={() => copyToClipboard(order)}
                            className="p-2 text-blue-500 hover:bg-blue-50 rounded-xl transition-all"
                            title="Copy to Clipboard"
                          >
                            <Copy size={18} />
                          </button>
                          <button 
                            onClick={() => setConfirmDeleteOrderId(order.id)}
                            className="p-2 text-slate-200 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                      
                  <div className="bg-slate-50/50 p-4 rounded-2xl space-y-3">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1">
                            <Clock size={10} /> {order.createdAt?.toDate().toLocaleString('en-LB', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Order ID: {order.id.slice(-4)}</span>
                        </div>
                        {order.items.map((item, i) => (
                          <div key={i} className="flex justify-between text-sm items-center">
                            <span className="text-slate-500 font-medium">{item.shop}</span>
                            <span className="font-black text-slate-800">{formatCurrency(item.price)}</span>
                          </div>
                        ))}
                        <div className="pt-2 border-t border-slate-200 flex justify-between text-sm items-center">
                          <span className="text-slate-400 font-bold uppercase text-[10px]">Delivery Fee</span>
                          <span className="font-black text-emerald-600">{formatCurrency(order.deliveryFee)}</span>
                        </div>
                      </div>

                      {/* Status Update Actions */}
                      <div className="flex gap-2 pt-2">
                        {order.status === 'pending' && (
                          <button 
                            onClick={() => updateOrderStatus(order.id, 'delivered')}
                            className="flex-1 bg-blue-500 text-white py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-2"
                          >
                            <Package size={14} />
                            Mark Delivered
                          </button>
                        )}
                        {order.status === 'delivered' && (
                          <button 
                            onClick={() => updateOrderStatus(order.id, 'paid')}
                            className="flex-1 bg-emerald-500 text-white py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
                          >
                            <CreditCard size={14} />
                            Mark Paid
                          </button>
                        )}
                        {order.status === 'paid' && (
                          <div className="flex-1 bg-emerald-50 text-emerald-600 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 border border-emerald-100">
                            <CheckCircle size={14} />
                            Payment Received
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {filteredOrders.length === 0 && (
                    <div className="text-center py-20 bg-white rounded-[2rem] border border-slate-100">
                      <History size={48} className="mx-auto text-slate-200 mb-4" />
                      <p className="text-slate-400 font-bold">No orders found</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Bottom Nav */}
        {user && (
          <nav className="fixed bottom-6 left-6 right-6 bg-slate-900/90 backdrop-blur-lg rounded-[2.5rem] p-3 flex justify-around items-center shadow-2xl z-30">
            <button 
              onClick={() => setView('home')}
              className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl transition-all ${view === 'home' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/40' : 'text-slate-400'}`}
            >
              <User size={24} strokeWidth={view === 'home' ? 3 : 2} />
              <span className="text-[10px] font-black uppercase tracking-widest">Clients</span>
            </button>
            <button 
              onClick={() => setView('stats')}
              className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl transition-all ${view === 'stats' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/40' : 'text-slate-400'}`}
            >
              <TrendingUp size={24} strokeWidth={view === 'stats' ? 3 : 2} />
              <span className="text-[10px] font-black uppercase tracking-widest">Stats</span>
            </button>
            <button 
              onClick={() => setView('history')}
              className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl transition-all ${view === 'history' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/40' : 'text-slate-400'}`}
            >
              <History size={24} strokeWidth={view === 'history' ? 3 : 2} />
              <span className="text-[10px] font-black uppercase tracking-widest">History</span>
            </button>
          </nav>
        )}

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {confirmDeleteId && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setConfirmDeleteId(null)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 relative z-10 shadow-2xl border border-slate-100"
              >
                <div className="bg-red-50 w-16 h-16 rounded-2xl flex items-center justify-center text-red-500 mb-6">
                  <Trash2 size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-900 mb-2">Delete Client?</h3>
                <p className="text-slate-500 mb-8 leading-relaxed">
                  Are you sure you want to remove this client? Their order history will remain, but the client record will be gone.
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmDeleteId(null)}
                    className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => deleteCustomer(confirmDeleteId)}
                    className="flex-1 bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-red-200 hover:bg-red-600 transition-all"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {confirmDeleteOrderId && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setConfirmDeleteOrderId(null)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 relative z-10 shadow-2xl border border-slate-100"
              >
                <div className="bg-red-50 w-16 h-16 rounded-2xl flex items-center justify-center text-red-500 mb-6">
                  <Trash2 size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-900 mb-2">Delete Order?</h3>
                <p className="text-slate-500 mb-8 leading-relaxed">
                  Are you sure you want to delete this order? This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmDeleteOrderId(null)}
                    className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => deleteOrder(confirmDeleteOrderId)}
                    className="flex-1 bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-red-200 hover:bg-red-600 transition-all"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {confirmMarkPaid && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setConfirmMarkPaid(false)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 relative z-10 shadow-2xl border border-slate-100"
              >
                <div className="bg-emerald-50 w-16 h-16 rounded-2xl flex items-center justify-center text-emerald-500 mb-6">
                  <CheckCircle size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-900 mb-2">Clear All Debt?</h3>
                <p className="text-slate-500 mb-8 leading-relaxed">
                  Mark all outstanding orders for <strong>{selectedCustomer?.name}</strong> as paid?
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmMarkPaid(false)}
                    className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={markAllAsPaid}
                    className="flex-1 bg-emerald-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-200 hover:bg-emerald-600 transition-all"
                  >
                    Confirm
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
