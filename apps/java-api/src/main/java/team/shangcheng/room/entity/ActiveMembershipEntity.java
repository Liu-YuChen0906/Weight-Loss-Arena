package team.shangcheng.room.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

@TableName("active_memberships")
@Getter
@Setter
public class ActiveMembershipEntity {

    @TableId(type = IdType.INPUT)
    private String userId;

    private String roomId;

    private String memberId;
}
