export type Role = 'customer'|'staff'|'admin';
export const UNITS = ['KG','CTN','PCS','BOX','PACK'] as const;
export const ORDER_STATUS = ['Pending','Accepted','Preparing','Ready','Out For Delivery','Delivered','Cancelled'] as const;
export interface PriceSlab {
  minQty: number;
  price: number;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  stock: number;
  unit: string;
  retailPrice: number;
  promoPrice?: number;
  staffPrice?: number;
  priceSlabs?: PriceSlab[];
  purchasePrice?: number;
  minPricePcs?: number;
  minPriceCtn?: number;
  status: 'active' | 'hidden';
}
export interface Settings { companyName:string; whatsappNumber:string; lowStockThreshold:number; currency:string; logoUrl?:string; supportEmail?:string; supportPhone?:string; }
