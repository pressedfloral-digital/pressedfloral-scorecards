-- Manual corrections to an employee's department and/or manager that survive
-- Rippling uploads. Uploaded rows stay exactly as Rippling sent them; the app
-- applies the override to every month from effective_from onward, and the
-- reporting tree below follows the override manager for those months.

create table if not exists public.employee_overrides (
  employee_name   text primary key,
  department      text,
  manager_id      uuid references public.manager_profiles(id) on delete set null,
  -- Display name written as the row's Manager: the picked user's linked
  -- employee name (or email), so the Rippling name chain agrees.
  manager_name    text,
  effective_from  text not null,  -- ISO month, e.g. '2026-09'
  updated_by      text,
  updated_at      timestamptz not null default now()
);

alter table public.employee_overrides enable row level security;

drop policy if exists "Authenticated users read employee overrides" on public.employee_overrides;
create policy "Authenticated users read employee overrides"
  on public.employee_overrides
  for select
  to authenticated
  using (true);

drop policy if exists "Admins manage employee overrides" on public.employee_overrides;
create policy "Admins manage employee overrides"
  on public.employee_overrides
  for all
  to authenticated
  using (private.scorecards_current_role() = 'admin')
  with check (private.scorecards_current_role() = 'admin');

grant select, insert, update, delete on table public.employee_overrides to authenticated;

-- Same as 20261006120000_linked_name_aliases, except an override manager
-- replaces the uploaded manager edges for the months it covers.
create or replace function private.scorecards_manages_employee(target_employee_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  with recursive overridden as (
    select o.employee_name, o.effective_from
    from public.employee_overrides o
    where o.manager_id is not null
  ),
  edges as (
    select re.manager as parent_node, re.full_name as child_node
    from public.rippling_employees re
    where re.manager is not null and re.manager <> ''
      and not exists (select 1 from overridden o where o.employee_name = re.full_name and re.period >= o.effective_from)
    union all
    select 'profile:' || re.assigned_manager_id::text, re.full_name
    from public.rippling_employees re
    where re.assigned_manager_id is not null
      and not exists (select 1 from overridden o where o.employee_name = re.full_name and re.period >= o.effective_from)
    union all
    -- Manual manager override.
    select 'profile:' || o.manager_id::text, o.employee_name
    from public.employee_overrides o
    where o.manager_id is not null
    union all
    -- An app user linked to an employee sits at that employee's spot in the tree.
    select p.linked_employee_name, 'profile:' || p.id::text
    from public.manager_profiles p
    where p.linked_employee_name is not null and p.linked_employee_name <> ''
    union all
    -- ...and at the spot of each of their alternate names.
    select alias, 'profile:' || p.id::text
    from public.manager_profiles p
    cross join lateral unnest(p.linked_name_aliases) as alias
    where alias <> ''
    union all
    -- Supervisor chain on the Users page.
    select 'profile:' || p.supervisor_id::text, 'profile:' || p.id::text
    from public.manager_profiles p
    where p.supervisor_id is not null
  ),
  reach as (
    select 'profile:' || id::text as node
    from public.manager_profiles
    where id = auth.uid()
    union
    select linked_employee_name
    from public.manager_profiles
    where id = auth.uid() and linked_employee_name is not null and linked_employee_name <> ''
    union
    select alias
    from public.manager_profiles p
    cross join lateral unnest(p.linked_name_aliases) as alias
    where p.id = auth.uid() and alias <> ''
    union
    select e.child_node
    from edges e
    join reach r on e.parent_node = r.node
  )
  select coalesce(target_employee_name, '') <> ''
    and exists (select 1 from reach where node = target_employee_name);
$$;

revoke execute on function private.scorecards_manages_employee(text) from public, anon;
grant execute on function private.scorecards_manages_employee(text) to authenticated;
