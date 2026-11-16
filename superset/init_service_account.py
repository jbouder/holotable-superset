"""Create the read-only service account the Holotable API and MCP server use.

Usage:
  python init_service_account.py                   create or refresh the account
  python init_service_account.py --examples-loaded exit 0 if example data exists

The role starts from Gamma, keeps only read permissions, and adds
all_datasource_access so every dataset is queryable. It cannot create or edit
charts, dashboards, datasets or SQL Lab queries.
"""

import os
import sys

from superset.app import create_app

ROLE_NAME = "HolotableReader"

app = create_app()

with app.app_context():
    from superset import security_manager as sm
    from superset.extensions import db

    if "--examples-loaded" in sys.argv:
        from superset.connectors.sqla.models import SqlaTable

        found = db.session.query(SqlaTable).filter_by(table_name="birth_names").first()
        sys.exit(0 if found else 1)

    gamma = sm.find_role("Gamma")
    read_only = [
        pvm
        for pvm in gamma.permissions
        if pvm.permission.name in sm.READ_ONLY_PERMISSION
    ]
    all_ds = sm.add_permission_view_menu("all_datasource_access", "all_datasource_access")

    role = sm.find_role(ROLE_NAME) or sm.add_role(ROLE_NAME)
    role.permissions = [*read_only, all_ds]

    username = os.environ["SUPERSET_SERVICE_USERNAME"]
    password = os.environ["SUPERSET_SERVICE_PASSWORD"]
    user = sm.find_user(username=username)
    if user is None:
        sm.add_user(
            username=username,
            first_name="Holotable",
            last_name="Service",
            email=f"{username}@holotable.local",
            role=role,
            password=password,
        )
    else:
        user.roles = [role]
        sm.reset_password(user.id, password)

    db.session.commit()
    print(f"[init] {username} has role {ROLE_NAME} with {len(role.permissions)} permissions")
