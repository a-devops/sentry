from django.db import models
from django.utils import timezone
from django.utils.translation import ugettext_lazy as _

from sentry.db.models import BoundedPositiveIntegerField, FlexibleForeignKey, Model, sane_repr
from sentry.models.release import DB_VERSION_LENGTH
from sentry.utils import metrics


class GroupResolution(Model):
    """
    Describes when a group was marked as resolved.
    """

    __include_in_export__ = False

    class Type:
        in_release = 0
        in_next_release = 1

    class Status:
        pending = 0
        resolved = 1

    group = FlexibleForeignKey("sentry.Group", unique=True)
    # the release in which its suggested this was resolved
    # which allows us to indicate if it still happens in newer versions
    release = FlexibleForeignKey("sentry.Release")
    # This release field represents the latest release version associated with a group when the
    # user chooses "resolve in next release", and is set for both semver and date ordered releases
    current_release_version = models.CharField(max_length=DB_VERSION_LENGTH, null=True, blank=True)
    type = BoundedPositiveIntegerField(
        choices=((Type.in_next_release, "in_next_release"), (Type.in_release, "in_release")),
        null=True,
    )
    actor_id = BoundedPositiveIntegerField(null=True)
    datetime = models.DateTimeField(default=timezone.now, db_index=True)
    status = BoundedPositiveIntegerField(
        default=Status.pending,
        choices=((Status.pending, _("Pending")), (Status.resolved, _("Resolved"))),
    )

    class Meta:
        db_table = "sentry_groupresolution"
        app_label = "sentry"

    __repr__ = sane_repr("group_id", "release_id")

    @classmethod
    def has_resolution(cls, group, release):
        """
        Determine if a resolution exists for the given group and release.

        This is used to suggest if a regression has occurred.
        """
        try:
            res_type, res_release, res_release_datetime = (
                cls.objects.filter(group=group)
                .select_related("release")
                .values_list("type", "release__id", "release__date_added")[0]
            )
        except IndexError:
            return False

        # if no release is present, we assume we've gone from "no release" to "some release"
        # in application configuration, and thus this must be older
        if not release:
            return True

        if res_type in (None, cls.Type.in_next_release):
            # Add metric here to ensure that this code branch ever runs given that
            # clear_expired_resolutions changes the type to `in_release` once a Release instance
            # is created
            metrics.incr("groupresolution.has_resolution.in_next_release", sample_rate=1.0)

            if res_release == release.id:
                return True
            elif res_release_datetime > release.date_added:
                return True
            return False
        elif res_type == cls.Type.in_release:
            if res_release == release.id:
                return False
            if res_release_datetime < release.date_added:
                return False
            return True
        else:
            raise NotImplementedError
