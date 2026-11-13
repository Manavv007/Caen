const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** 38500 -> "₹38,500" */
export const formatInr = (n) => inr.format(n);
