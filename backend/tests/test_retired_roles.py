"""下线内置角色迁移测试。

- 存量库中的角色行、用户绑定与权限绑定一并删除；
- 权限 codename 本身保留（其它内置角色仍在使用）；
- 重复执行无副作用。
"""

from sqlalchemy import select

from app.core.security import get_password_hash
from app.models.permission import Permission
from app.models.role import Role, role_permissions, user_roles
from app.models.user import USER_STATUS_APPROVED, User
from app.seed import RETIRED_ROLE_NAMES, migrate_retired_roles


def test_retired_roles_migration_cleans_database(db):
    audit_perm = db.scalars(
        select(Permission).where(Permission.codename == "audit:read")
    ).one()

    retired_roles = []
    for name in RETIRED_ROLE_NAMES:
        role = Role(name=name)
        role.permissions = [audit_perm]
        db.add(role)
        retired_roles.append(role)
    db.flush()

    alice = User(
        username="alice",
        hashed_password=get_password_hash("test-password"),
        is_active=True,
        status=USER_STATUS_APPROVED,
        roles=list(retired_roles),
    )
    db.add(alice)
    db.commit()

    retired_ids = [role.id for role in retired_roles]
    assert (
        db.execute(
            select(user_roles.c.role_id).where(user_roles.c.role_id.in_(retired_ids))
        ).all()
        != []
    )

    migrate_retired_roles()
    db.expire_all()

    assert db.scalars(select(Role).where(Role.name.in_(RETIRED_ROLE_NAMES))).all() == []
    assert (
        db.execute(
            select(role_permissions.c.role_id).where(
                role_permissions.c.role_id.in_(retired_ids)
            )
        ).all()
        == []
    )
    assert (
        db.execute(
            select(user_roles.c.role_id).where(user_roles.c.role_id.in_(retired_ids))
        ).all()
        == []
    )
    # 权限本身是共享资源，不能随角色一起删除
    assert db.get(Permission, audit_perm.id) is not None

    # 幂等：无残留时再次执行不报错、不改变数据
    migrate_retired_roles()
