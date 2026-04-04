import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import * as InAppPurchases from 'expo-in-app-purchases';

const PurchaseContext = createContext();

const PRODUCT_IDS = [
  'com.pieterpreseun.swipeclean.pro',
  'com.pieterpreseun.swipeclean.weekly',
];

export function PurchaseProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const connectedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        // Connect to the store
        await InAppPurchases.connectAsync();
        connectedRef.current = true;

        // Set up purchase listener
        InAppPurchases.setPurchaseListener(({ responseCode, results }) => {
          if (responseCode === InAppPurchases.IAPResponseCode.OK && results) {
            for (const purchase of results) {
              if (!purchase.acknowledged) {
                // Finish the transaction
                InAppPurchases.finishTransactionAsync(purchase, true);
              }
              // Grant pro access
              if (mounted) setIsPro(true);
            }
          }
        });

        // Get available products with localized prices
        const { responseCode, results } = await InAppPurchases.getProductsAsync(PRODUCT_IDS);
        if (responseCode === InAppPurchases.IAPResponseCode.OK && results && mounted) {
          setProducts(results);
        }

        // Check for existing purchases
        const { responseCode: historyCode, results: history } = await InAppPurchases.getPurchaseHistoryAsync();
        if (historyCode === InAppPurchases.IAPResponseCode.OK && history && mounted) {
          for (const purchase of history) {
            if (PRODUCT_IDS.includes(purchase.productId)) {
              setIsPro(true);
              break;
            }
          }
        }
      } catch (err) {
        console.warn('IAP init error:', err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();

    return () => {
      mounted = false;
      if (connectedRef.current) {
        InAppPurchases.disconnectAsync().catch(() => {});
      }
    };
  }, []);

  const purchaseProduct = useCallback(async (productId) => {
    try {
      await InAppPurchases.purchaseItemAsync(productId);
    } catch (err) {
      console.warn('Purchase error:', err.message);
    }
  }, []);

  const restorePurchases = useCallback(async () => {
    try {
      const { responseCode, results } = await InAppPurchases.getPurchaseHistoryAsync();
      if (responseCode === InAppPurchases.IAPResponseCode.OK && results) {
        for (const purchase of results) {
          if (PRODUCT_IDS.includes(purchase.productId)) {
            setIsPro(true);
            return true;
          }
        }
      }
      return false;
    } catch (err) {
      console.warn('Restore error:', err.message);
      return false;
    }
  }, []);

  // Find products by ID
  const proProduct = products.find((p) => p.productId === 'com.pieterpreseun.swipeclean.pro');
  const weeklyProduct = products.find((p) => p.productId === 'com.pieterpreseun.swipeclean.weekly');

  return (
    <PurchaseContext.Provider value={{
      isPro,
      loading,
      proProduct,
      weeklyProduct,
      purchaseProduct,
      restorePurchases,
    }}>
      {children}
    </PurchaseContext.Provider>
  );
}

export function usePurchases() {
  return useContext(PurchaseContext);
}
