-- ================================================================
-- 007_order_sync.sql
-- ① orders テーブル拡張（配送・住所フィールド追加）
-- ② customer_profiles に total_purchase_amount 追加
-- ③ malls シード補完（Amazon / Yahoo）
-- ④ sync_order_from_api RPC 関数
--    find-order の `order` オブジェクトを受け取り
--    orders / order_items を UPSERT し
--    customer_profiles を orders から再集計する
-- ================================================================

-- ----------------------------------------------------------------
-- 1. orders 追加カラム
-- ----------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipment_status   TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number   TEXT,
  ADD COLUMN IF NOT EXISTS carrier           TEXT,
  ADD COLUMN IF NOT EXISTS delivery_date     DATE,
  ADD COLUMN IF NOT EXISTS buyer_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS buyer_address     TEXT;

-- ----------------------------------------------------------------
-- 2. customer_profiles に total_purchase_amount を追加
-- ----------------------------------------------------------------
ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS total_purchase_amount NUMERIC(14, 2);

-- ----------------------------------------------------------------
-- 3. malls シード補完
-- ----------------------------------------------------------------
INSERT INTO malls (code, name) VALUES
  ('amazon', 'Amazon'),
  ('yahoo',  'Yahoo!ショッピング')
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------
-- 4. sync_order_from_api 関数
--
-- 引数:
--   p_source_channel TEXT  -- 'rakuten' | 'yahoo' | 'amazon'
--   p_mall_code      TEXT  -- malls.code と同値
--   p_order_data     JSONB -- find-order が返す order オブジェクト
--
-- 戻り値:
--   成功: {"ok": true,  "order_id": "...", "customer_profile_id": "..." or null}
--   失敗: {"ok": false, "reason": "...", "detail": "..."}
--
-- 設計:
--   - 例外はすべて握り潰して JSON で返す（呼び出し元の CS 対応を止めない）
--   - customer_profile_id は email マッチ → 注文番号フォールバックで解決
--   - UPSERT 時に既存行に customer_profile_id が入っていれば上書きしない
--   - order_items はこの order_id 分だけ削除して再 INSERT（他注文に影響なし）
--   - customer_profiles の再集計は orders テーブル全体から行う（加算なし）
-- ----------------------------------------------------------------
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
  -- ---- 入力値の取り出し ----
  v_external_order_id := trim(p_order_data->>'mallOrderNumber');
  v_mall_order_number  := v_external_order_id;
  v_buyer_email        := lower(trim(COALESCE(p_order_data->>'buyerEmail', '')));

  IF v_external_order_id IS NULL OR v_external_order_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_mallOrderNumber');
  END IF;

  -- ---- mall_id 解決（見つからなければ NULL のまま続行）----
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
  IF v_customer_profile_id IS NULL THEN
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
    -- customer_profile_id: 既存に値があれば保持、なければ今回のマッチ結果で上書き
    customer_profile_id = COALESCE(orders.customer_profile_id, EXCLUDED.customer_profile_id),
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

  -- ---- order_items 差し替え（この order_id 分のみ）----
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

  -- ---- customer_profiles 再集計（customer_profile_id がある場合のみ）----
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

-- ----------------------------------------------------------------
-- 5. 実行権限
-- ----------------------------------------------------------------
GRANT EXECUTE ON FUNCTION sync_order_from_api(TEXT, TEXT, JSONB)
  TO authenticated, service_role;
