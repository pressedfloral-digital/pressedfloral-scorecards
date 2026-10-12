-- Team members entered by hand for a period they aren't in the Rippling upload for (e.g. a
-- rehire before their first payroll), so an admin can still build their scorecard. Kept apart
-- from rippling_employees: the app treats any row there as "this month was uploaded", and a
-- Rippling upload rewrites the month. Period is an ISO month; quarterly scorecards use the
-- quarter's first month, and the pay/hours entered cover the whole period.

create table if not exists public.manual_employees (
  id                   uuid primary key default gen_random_uuid(),
  period               text not null,
  full_name            text not null,
  role                 text not null default '',
  department           text not null default '',
  location             text not null default '',
  manager              text,
  assigned_manager_id  uuid references public.manager_profiles(id) on delete set null,
  pay_type             text not null default 'hourly',
  hourly_rate          numeric,
  annual_pay           numeric,
  hours_worked         numeric,
  gross_earnings       numeric,
  created_by           text,
  updated_at           timestamptz not null default now(),
  unique (period, full_name)
);

alter table public.manual_employees enable row level security;

drop policy if exists "Authenticated users read manual employees" on public.manual_employees;
create policy "Authenticated users read manual employees"
  on public.manual_employees
  for select
  to authenticated
  using (true);

drop policy if exists "Admins manage manual employees" on public.manual_employees;
create policy "Admins manage manual employees"
  on public.manual_employees
  for all
  to authenticated
  using (private.scorecards_current_role() = 'admin')
  with check (private.scorecards_current_role() = 'admin');

grant select, insert, update, delete on table public.manual_employees to authenticated;

-- Same as 20261006130000_employee_overrides, plus manual employees' manager edges, so their
-- manager can read and review the scorecard.
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
    -- Manually entered team members.
    select me.manager, me.full_name
    from public.manual_employees me
    where me.manager is not null and me.manager <> ''
    union all
    select 'profile:' || me.assigned_manager_id::text, me.full_name
    from public.manual_employees me
    where me.assigned_manager_id is not null
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
