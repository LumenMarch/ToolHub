from sqlalchemy.orm import Session

from app.models.permission import Permission


def get_all_permissions(db: Session) -> list[Permission]:
    return db.query(Permission).order_by(Permission.codename).all()


def get_permission_by_codename(db: Session, codename: str) -> Permission | None:
    return db.query(Permission).filter(Permission.codename == codename).first()


def get_permissions_by_ids(db: Session, ids: list[int]) -> list[Permission]:
    return db.query(Permission).filter(Permission.id.in_(ids)).all()
