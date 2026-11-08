package team.shangcheng.support.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import team.shangcheng.support.entity.SupportRequestEntity;

@Mapper
public interface SupportMapper extends BaseMapper<SupportRequestEntity> {}
