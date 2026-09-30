'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Search, UserCircle } from 'lucide-react';
import { CustomerDetailModal } from '@/components/admin/CustomerDetailModal';

const navItems = [
    { name: 'Dashboard', href: '/admin/dashboard' },
    { name: 'Products', href: '/admin/products' },
    { name: 'Cashiers', href: '/admin/cashiers' },
    { name: 'Reports', href: '/admin/reports' },
    { name: 'Settings', href: '/admin/settings' },
    { name: 'Approvals', href: '/admin/approvals' },
];

export function AdminNavbar() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [customers, setCustomers] = useState<any[]>([]);
    const [customersLoading, setCustomersLoading] = useState(true);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const pathname = usePathname();
    const [pendingApprovals, setPendingApprovals] = useState(0);

    useEffect(() => {
        fetchCustomers();
    }, []);

    // Live pending count so the admin sees the BIR manual queue is waiting
    const fetchPendingApprovals = useCallback(async () => {
        try {
            const { count, error } = await supabase
                .from('manual_entry_requests')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'pending');
            if (error) throw error;
            setPendingApprovals(count || 0);
        } catch (error) {
            console.error('[ApprovalsBadge] Error fetching pending count:', error);
        }
    }, []);

    useEffect(() => {
        fetchPendingApprovals();
        // Refresh whenever the admin navigates to or away from the queue
    }, [pathname, fetchPendingApprovals]);

    // Keep the badge live while the admin sits on other pages
    useEffect(() => {
        const interval = setInterval(fetchPendingApprovals, 60000);
        return () => clearInterval(interval);
    }, [fetchPendingApprovals]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchCustomers = async () => {
        setCustomersLoading(true);
        try {
            console.log('[CustomerSearch] Fetching customers...');
            const { data, error } = await supabase
                .from('customers')
                .select('*')
                .order('name', { ascending: true });
            if (error) throw error;
            console.log('[CustomerSearch] Customers loaded:', data?.length || 0, data);
            setCustomers(data || []);
        } catch (error) {
            console.error('[CustomerSearch] Error fetching customers:', error);
        } finally {
            setCustomersLoading(false);
        }
    };

    const filteredCustomers = useMemo(() => {
        if (!searchTerm.trim()) return [];
        const term = searchTerm.toLowerCase();
        const filtered = customers.filter(c =>
            c.name.toLowerCase().includes(term)
        ).slice(0, 8);
        console.log('[CustomerSearch] searchTerm:', searchTerm, 'filtered:', filtered.length, 'total customers:', customers.length);
        return filtered;
    }, [customers, searchTerm]);

    const handleCustomerClick = (customer: any) => {
        setSelectedCustomer(customer);
        setIsDetailModalOpen(true);
        setIsDropdownOpen(false);
        setSearchTerm('');
    };

    const handleSignOut = async () => {
        // Clear all Supabase auth cookies
        document.cookie.split('; ').forEach(c => {
            const name = c.split('=')[0];
            if (name.startsWith('sb-') || name === 'supabase-auth-token') {
                document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
            }
        });
        // Full page reload to clear all client state and re-run middleware
        window.location.href = '/';
    };

    return (
        <>
            <nav className="bg-white dark:bg-gray-800 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex">
                            <div className="flex-shrink-0 flex items-center">
                                <img src="/logo.jpg" alt="Logo" className="w-8 h-8 rounded-lg object-cover shadow-sm" />
                                <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">POS Admin</span>
                            </div>
                            {/* Desktop navigation */}
                            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                                {navItems.map((item) => (
                                    <a
                                        key={item.name}
                                        href={item.href}
                                        className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${pathname === item.href
                                            ? 'border-primary-500 text-gray-900 dark:text-white'
                                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-200'
                                            }`}
                                    >
                                        {item.name}
                                        {item.name === 'Approvals' && pendingApprovals > 0 && (
                                            <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-black">
                                                {pendingApprovals}
                                            </span>
                                        )}
                                    </a>
                                ))}
                            </div>
                        </div>
                        <div className="hidden sm:ml-6 sm:flex sm:items-center space-x-2">
                            <div ref={searchRef} className="relative">
                                <div className="relative group">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                    <Input
                                        placeholder="Search customers..."
                                        className="pl-8 h-9 w-44 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 focus:ring-primary text-xs rounded-lg"
                                        value={searchTerm}
                                        onChange={(e) => {
                                            setSearchTerm(e.target.value);
                                            setIsDropdownOpen(true);
                                        }}
                                        onFocus={() => setIsDropdownOpen(true)}
                                    />
                                </div>
                                {isDropdownOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden z-50">
                                        {customersLoading ? (
                                            <div className="p-4 space-y-3">
                                                {[1, 2, 3].map(i => (
                                                    <div key={i} className="h-10 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
                                                ))}
                                            </div>
                                        ) : filteredCustomers.length > 0 ? (
                                            <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-72 overflow-y-auto">
                                                {filteredCustomers.map((c) => (
                                                    <li key={c.id}>
                                                        <button
                                                            onClick={() => handleCustomerClick(c)}
                                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                                                        >
                                                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                                                                <UserCircle className="h-5 w-5" />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{c.name}</p>
                                                                <p className="text-[10px] text-muted-foreground">
                                                                    Customer since {new Date(c.created_at).toLocaleDateString()}
                                                                </p>
                                                            </div>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : searchTerm.trim() ? (
                                            <div className="p-6 text-center">
                                                <UserCircle className="h-8 w-8 mx-auto mb-2 opacity-20 text-muted-foreground" />
                                                <p className="text-sm font-medium text-muted-foreground">No customers found</p>
                                                <p className="text-[10px] text-muted-foreground mt-0.5">Try a different search term.</p>
                                            </div>
                                        ) : (
                                            <div className="p-4 text-center text-xs text-muted-foreground">
                                                Start typing to search customers
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <ThemeToggle />
                            <Button
                                onClick={handleSignOut}
                                variant="outline"
                                size="sm"
                                className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                                Sign out
                            </Button>
                        </div>
                        {/* Mobile menu button */}
                        <div className="flex items-center sm:hidden">
                            <button
                                onClick={() => setIsMobileMenuOpen(true)}
                                className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
                            >
                                <span className="sr-only">Open main menu</span>
                                <svg className="block h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Mobile menu modal */}
            <Modal
                isOpen={isMobileMenuOpen}
                onClose={() => setIsMobileMenuOpen(false)}
                title="Navigation"
                size="fullscreen"
            >
                <div className="flex flex-col space-y-4">
                    {navItems.map((item) => (
                        <a
                            key={item.name}
                            href={item.href}
                            className={`block px-4 py-3 text-lg font-medium rounded-lg transition-colors duration-200 ${pathname === item.href
                                ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                            onClick={() => setIsMobileMenuOpen(false)}
                        >
                            <span className="flex items-center justify-between">
                                {item.name}
                                {item.name === 'Approvals' && pendingApprovals > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-black">
                                        {pendingApprovals}
                                    </span>
                                )}
                            </span>
                        </a>
                    ))}
                    <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
                        <Button
                            onClick={handleSignOut}
                            variant="outline"
                            className="w-full justify-start text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
                        >
                            Sign out
                        </Button>
                    </div>
                </div>
            </Modal>

            <CustomerDetailModal
                customer={selectedCustomer}
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
            />
        </>
    );
}
