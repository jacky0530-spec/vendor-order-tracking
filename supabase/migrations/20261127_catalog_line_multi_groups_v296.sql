--宜羿 B2B V2.96 / 2026-11-27
-- Deployed on Supabase project qibeuakrryqjaiwbcorg.
-- One RPC call inserts an all-or-none batch of group-specific scheduled pushes.
-- Each push references the same stored DM PNG and JPEG preview image.
CREATE OR REPLACE FUNCTION public.catalog_line_schedule_push_multi(p_group_ids uuid[], p_product_ids uuid[], p_scheduled_at timestamp with time zone, p_dm_storage_path text, p_preview_storage_path text, p_intro text DEFAULT ''::text, p_mall_url text DEFAULT 'https://jacky0530-spec.github.io/vendor-order-tracking/'::text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gid uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_job uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.catalog_is_manager() THEN
    RAISE EXCEPTION '僅管理員可建立 LINE 推播排程';
  END IF;
  IF p_group_ids IS NULL OR cardinality(p_group_ids) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '一次請選擇 1 至 100 個 LINE 群組';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_group_ids) AS x(id) WHERE x.id IS NULL)
     OR (SELECT count(DISTINCT x.id) FROM unnest(p_group_ids) AS x(id)) <> cardinality(p_group_ids) THEN
    RAISE EXCEPTION '群組不得空白或重複選取';
  END IF;
  -- Single database transaction: one invalid group or product rolls back all jobs.
  FOREACH v_gid IN ARRAY p_group_ids LOOP
    v_job := public.catalog_line_schedule_push(
      v_gid,p_product_ids,p_scheduled_at,p_dm_storage_path,
      p_preview_storage_path,p_intro,p_mall_url
    );
    v_ids := array_append(v_ids,v_job);
  END LOOP;
  RETURN v_ids;
END;
$function$
;
REVOKE ALL ON FUNCTION public.catalog_line_schedule_push_multi(uuid[],uuid[],timestamptz,text,text,text,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.catalog_line_schedule_push_multi(uuid[],uuid[],timestamptz,text,text,text,text)
 TO authenticated;
COMMENT ON FUNCTION public.catalog_line_schedule_push_multi(uuid[],uuid[],timestamptz,text,text,text,text)
 IS 'Manager-only all-or-none scheduling to 1-100 unique active LINE groups with one shared DM.';
