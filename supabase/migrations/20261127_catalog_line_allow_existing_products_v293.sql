-- V2.93 2026-11-27
-- Existing publicly sellable products may be included in a LINE DM without republishing.
-- Preserve manager authorization, max 6, scheduled availability, group opt-in and image paths.
-- Applied to Supabase using migration: catalog_line_allow_existing_on_sale_products_v293

CREATE OR REPLACE FUNCTION public.catalog_line_schedule_push(p_group_id uuid, p_product_ids uuid[], p_scheduled_at timestamp with time zone, p_dm_storage_path text, p_preview_storage_path text, p_intro text DEFAULT ''::text, p_mall_url text DEFAULT 'https://jacky0530-spec.github.io/vendor-order-tracking/'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_snapshot jsonb; v_count integer; v_id uuid;
BEGIN
 IF NOT public.catalog_is_manager() OR auth.uid() IS NULL THEN RAISE EXCEPTION '僅管理員可排程'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.catalog_line_groups
   WHERE id=p_group_id AND active AND connected) THEN RAISE EXCEPTION '群組尚未啟用或已退出'; END IF;
 IF p_product_ids IS NULL OR cardinality(p_product_ids) NOT BETWEEN 1 AND 6 OR
    (SELECT count(DISTINCT x) FROM unnest(p_product_ids) x)<>cardinality(p_product_ids) THEN
   RAISE EXCEPTION '每張 DM 必須選 1 至 6 件不重複新品'; END IF;
 IF p_scheduled_at IS NULL OR p_scheduled_at<now()-interval '30 seconds'
   OR p_scheduled_at>now()+interval '90 days' THEN RAISE EXCEPTION '請設定未來 90 天內的發送時間'; END IF;
 IF p_dm_storage_path NOT LIKE auth.uid()::text||'/%'
   OR p_dm_storage_path !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}[.]png$' THEN
   RAISE EXCEPTION 'DM 圖片路徑無效'; END IF;
 IF p_preview_storage_path NOT LIKE auth.uid()::text||'/%'
   OR p_preview_storage_path !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}-preview[.]jpg$' THEN
   RAISE EXCEPTION 'LINE 預覽圖路徑無效'; END IF;
 IF p_mall_url NOT LIKE 'https://jacky0530-spec.github.io/vendor-order-tracking/%' THEN
   RAISE EXCEPTION '商城網址必須使用宜羿商城固定網域'; END IF;
 SELECT count(*),jsonb_agg(jsonb_build_object('id',p.id,'code',p.product_code,
   'name',p.name,'price',p.base_price) ORDER BY u.ord)
 INTO v_count,v_snapshot
 FROM unnest(p_product_ids) WITH ORDINALITY u(product_id,ord)
 JOIN public.catalog_products p ON p.id=u.product_id
 WHERE p.active IS TRUE AND p.published IS TRUE AND p.archived_at IS NULL
   AND p.visibility_mode='all'
   AND (p.sale_start_at IS NULL OR p.sale_start_at<=now())
   AND (p.sale_end_at IS NULL OR p.sale_end_at>now())
   AND (p.sale_start_at IS NULL OR p.sale_start_at<=p_scheduled_at)
   AND (p.sale_end_at IS NULL OR p.sale_end_at>p_scheduled_at);
 IF v_count IS DISTINCT FROM cardinality(p_product_ids) THEN
   RAISE EXCEPTION '有商品尚未公開販售、已結單或於預定發送時間無法購買'; END IF;
 INSERT INTO public.catalog_line_push_jobs(group_id,product_ids,product_snapshot,
      dm_storage_path,preview_storage_path,intro,mall_url,scheduled_at,created_by)
 VALUES(p_group_id,p_product_ids,v_snapshot,p_dm_storage_path,p_preview_storage_path,
        left(coalesce(nullif(btrim(p_intro),''),'新品上架，歡迎查看商城！'),250),
        p_mall_url,p_scheduled_at,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END; $function$
;
