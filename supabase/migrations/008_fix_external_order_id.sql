-- ================================================================
-- 008_fix_external_order_id.sql
-- sync_order_from_api の修正:
--   external_order_id に mallOrderNumber ではなく BOSS orderId を格納する
-- ================================================================

CREATE OR REPLACE FUNCTION sync_order_from_api(
  p_source_channel TEXT,
  p_mall_code      TEXT,
  p_order_data     JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mall_id             UUID;
  v_order_id            UUID;
  v_customer_profile_id UUID;
  v_external_order_id   TEXT;
  v_mall_order_number   TEXT;
  v_buyer_email         TEXT;
  v_order_count         INT;
  v_last_order_at       TIMESTAMPTZ;
  v_total_purchase      NUMERIC;
BEGIN
  -- BOSS orderId（数値）を external_order_id として使用
  v_external_order_id := trim(p_order_data->>'orderId');
  -- Rakuten 注文番号（例: 1234-56789012-1234567）は order_number に格納
  v_mall_order_number  := trim(p_order_data->>'mallOrderNumber');
  v_buyer_email        := lower(trim(COALESCE(p_order_data->>'buyerEmail', '')));

  IF v_external_order_id IS NULL OR v_external_order_id = '' THEN
    -- orderId がない場合は mallOrderNumber にフォールバック
    v_external_order_id := v_mall_order_number;
  END IF;

  IF v_external_order_id IS NULL OR v_external_order_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_orderId_and_mallOrderNumber');
  END IF;

  -- ---- mall_id 解決 ----
  SELECT id INTO v_mall_id FROM malls WHERE code = p_mall_code;

  -- ---- customer_profile_id 解決 ①: buyer_email マッチ ----
  IF v_buyer_email <> '' THEN
    SELECT id INTO v_customer_profile_id
    FROM customer_profiles
    WHERE lower(trim(COALESCE(primary_email, '')))  = v_buyer_email
       OR lower(trim(COALESCE(customer_email, ''))) = v_buyer_email
    LIMIT 1;
  END IF;

  -- ---- customer_profile_id 解決 ②: 注文番号 → inquiries フォールバック ----
  IF v_customer_profile_id IS NULL AND v_mall_order_number IS NOT NULL THEN
    SELECT customer_profile_id INTO v_customer_profile_id
    FROM inquiries
    WHERE order_number = v_mall_order_number
      AND customer_profile_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- ---- orders UPSERT ----
  INSERT INTO orders (
    customer_profile_id,
    mall_id,
    source_channel,
    external_order_id,
    order_number,
    ordered_at,
    total_amount,
    currency,
    buyer_name,
    buyer_email,
    status,
    shipment_status,
    tracking_number,
    carrier,
    delivery_date,
    buyer_postal_code,
    buyer_address,
    raw_payload
  ) VALUES (
    v_customer_profile_id,
    v_mall_id,
    p_source_channel,
    v_external_order_id,
    v_mall_order_number,
    NULLIF(trim(p_order_data->>'mallOrderDateTime'), '')::TIMESTAMPTZ,
    NULLIF(p_order_data->>'totalPrice', '')::NUMERIC,
    'JPY',
    NULLIF(trim(p_order_data->>'buyerName'),    ''),
    NULLIF(trim(p_order_data->>'buyerEmail'),   ''),
    COALESCE(NULLIF(trim(p_order_data->>'orderStatus'), ''), 'unknown'),
    NULLIF(trim(p_order_data->>'shipmentStatus'),    ''),
    NULLIF(trim(p_order_data->>'trackingNumber'),    ''),
    NULLIF(trim(p_order_data->>'carrier'),           ''),
    NULLIF(trim(p_order_data->>'resultDeliveryDate'),'')::DATE,
    NULLIF(trim(p_order_data->>'postalCode'),        ''),
    NULLIF(trim(p_order_data->>'address'),           ''),
    p_order_data
  )
  ON CONFLICT (source_channel, external_order_id) DO UPDATE SET
    customer_profile_id = COALESCE(orders.customer_profile_id, EXCLUDED.customer_profile_id),
    order_number        = EXCLUDED.order_number,
    ordered_at          = EXCLUDED.ordered_at,
    total_amount        = EXCLUDED.total_amount,
    buyer_name          = EXCLUDED.buyer_name,
    buyer_email         = EXCLUDED.buyer_email,
    status              = EXCLUDED.status,
    shipment_status     = EXCLUDED.shipment_status,
    tracking_number     = EXCLUDED.tracking_number,
    carrier             = EXCLUDED.carrier,
    delivery_date       = EXCLUDED.delivery_date,
    buyer_postal_code   = EXCLUDED.buyer_postal_code,
    buyer_address       = EXCLUDED.buyer_address,
    raw_payload         = EXCLUDED.raw_payload,
    updated_at          = now()
  RETURNING id, customer_profile_id
  INTO v_order_id, v_customer_profile_id;

  -- ---- order_items 差し替え ----
  DELETE FROM order_items WHERE order_id = v_order_id;

  INSERT INTO order_items (order_id, sku, item_name, quantity, unit_price, raw_payload)
  SELECT
    v_order_id,
    NULLIF(trim(item->>'skuCode'), ''),
    item->>'itemName',
    COALESCE(NULLIF(item->>'quantity', '')::INT, 1),
    NULLIF(item->>'unitPrice', '')::NUMERIC,
    item
  FROM jsonb_array_elements(COALESCE(p_order_data->'items', '[]'::JSONB)) AS t(item);

  -- ---- customer_profiles 再集計 ----
  IF v_customer_profile_id IS NOT NULL THEN
    SELECT
      COUNT(*)::INT,
      MAX(ordered_at),
      SUM(total_amount)
    INTO v_order_count, v_last_order_at, v_total_purchase
    FROM orders
    WHERE customer_profile_id = v_customer_profile_id;

    UPDATE customer_profiles SET
      order_count           = v_order_count,
      last_order_at         = v_last_order_at,
      total_purchase_amount = v_total_purchase,
      updated_at            = now()
    WHERE id = v_customer_profile_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'order_id',            v_order_id,
    'customer_profile_id', v_customer_profile_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok',     false,
    'reason', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION sync_order_from_api(TEXT, TEXT, JSONB)
  TO authenticated, service_role;
